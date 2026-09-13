//! Pipes frames through the `ffmpeg` binary. The CLI is the only FFmpeg
//! interface stable across major versions, so one prebuilt artifact runs
//! against whatever FFmpeg the host has. Nothing here links libav*.

use std::io::{Read, Write};
use std::os::unix::process::CommandExt;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender, TryRecvError};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crate::{
    encoded_packet_outputs, normalize_h264_packet, EncodedOutput, VideoEncoder, BIT_RATE, FPS,
};

/// Output that misses this window is drained on a later call, not dropped.
const DRAIN_TIMEOUT: Duration = Duration::from_millis(4);

/// A running `ffmpeg` has no channel for an on-demand IDR, so a subscriber
/// joining mid-stream waits at most this long for a decodable frame.
const KEYFRAME_INTERVAL_SECONDS: f64 = 0.5;

pub struct CliEncoder {
    width: u32,
    height: u32,
    frame_bytes: usize,
    child: Child,
    stdin: Option<ChildStdin>,
    access_units: Receiver<Vec<u8>>,
    reader: Option<JoinHandle<()>>,
}

impl CliEncoder {
    pub fn new(width: u32, height: u32) -> std::result::Result<Self, String> {
        let binary = std::env::var("AGENTSIMS_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string());
        let mut command = Command::new(&binary);
        command
            .args(["-hide_banner", "-loglevel", "error"])
            .args(["-f", "rawvideo", "-pix_fmt", "rgba"])
            .args(["-s", &format!("{width}x{height}")])
            .args(["-r", &FPS.to_string()])
            .args(["-i", "pipe:0", "-an"]);
        for argument in platform_encoder_arguments() {
            command.arg(argument);
        }
        command
            .args(["-b:v", &BIT_RATE.to_string()])
            .args(["-g", &(FPS * 5).to_string()])
            .args(["-bf", "0", "-flags", "+low_delay"])
            .args([
                "-force_key_frames",
                &format!("expr:gte(t,n_forced*{KEYFRAME_INTERVAL_SECONDS})"),
            ])
            .args(["-flush_packets", "1", "-avioflags", "direct"])
            .args(["-f", "h264", "pipe:1"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            // The terminal sends Ctrl+C to its foreground process group. Keep
            // ffmpeg outside the CLI group so the CLI can close it in order:
            // stop frames, close stdin, drain stdout, then wait for exit.
            .process_group(0);

        let mut child = command.spawn().map_err(|error| {
            format!("spawn {binary}: {error}. Install FFmpeg or set AGENTSIMS_FFMPEG.")
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "ffmpeg stdin was not piped".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "ffmpeg stdout was not piped".to_string())?;

        let (sender, access_units) = channel();
        let reader = thread::Builder::new()
            .name("agentsims-ffmpeg-reader".to_string())
            .spawn(move || read_access_units(stdout, sender))
            .map_err(|error| {
                let _ = child.kill();
                let _ = child.wait();
                format!("spawn ffmpeg reader: {error}")
            })?;

        Ok(Self {
            width,
            height,
            frame_bytes: width as usize * height as usize * 4,
            child,
            stdin: Some(stdin),
            access_units,
            reader: Some(reader),
        })
    }

    fn drain(&mut self) -> Vec<EncodedOutput> {
        let mut outputs = Vec::new();
        let mut pending = self.access_units.recv_timeout(DRAIN_TIMEOUT).ok();
        while let Some(unit) = pending {
            match normalize_h264_packet(&unit) {
                Ok(normalized) => {
                    let keyframe = normalized.nals.iter().any(|nal| crate::nal_type(nal) == 5);
                    outputs.extend(encoded_packet_outputs(
                        &normalized,
                        keyframe,
                        self.width,
                        self.height,
                    ));
                }
                Err(error) => eprintln!("[android-video] {error}"),
            }
            pending = match self.access_units.try_recv() {
                Ok(unit) => Some(unit),
                Err(TryRecvError::Empty | TryRecvError::Disconnected) => None,
            };
        }
        outputs
    }
}

impl VideoEncoder for CliEncoder {
    fn width(&self) -> u32 {
        self.width
    }

    fn height(&self) -> u32 {
        self.height
    }

    fn encode(
        &mut self,
        rgba: &[u8],
        _force_keyframe: bool,
    ) -> std::result::Result<Vec<EncodedOutput>, String> {
        if rgba.len() < self.frame_bytes {
            return Err(format!(
                "RGBA mmap is too small: need {} bytes, found {}",
                self.frame_bytes,
                rgba.len()
            ));
        }
        let Some(stdin) = self.stdin.as_mut() else {
            return Err("ffmpeg stdin is already closed".to_string());
        };
        stdin
            .write_all(&rgba[..self.frame_bytes])
            .map_err(|error| format!("write frame to ffmpeg: {error}"))?;
        stdin
            .flush()
            .map_err(|error| format!("flush ffmpeg stdin: {error}"))?;
        Ok(self.drain())
    }
}

impl Drop for CliEncoder {
    fn drop(&mut self) {
        drop(self.stdin.take());
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[cfg(target_os = "macos")]
fn platform_encoder_arguments() -> Vec<&'static str> {
    vec![
        "-c:v",
        "h264_videotoolbox",
        "-realtime",
        "1",
        "-prio_speed",
        "1",
        "-profile:v",
        "high",
        "-allow_sw",
        "0",
    ]
}

#[cfg(not(target_os = "macos"))]
fn platform_encoder_arguments() -> Vec<&'static str> {
    vec![
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-tune",
        "zerolatency",
        "-profile:v",
        "high",
    ]
}

/// Splits the Annex B stream into access units. A unit is complete only once
/// the NAL that starts the next one arrives.
fn read_access_units(mut stdout: impl Read, sender: Sender<Vec<u8>>) {
    let mut stream = Vec::new();
    let mut buffer = [0u8; 64 * 1024];
    let mut pending: Vec<u8> = Vec::new();
    let mut pending_has_slice = false;

    loop {
        let read = match stdout.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                eprintln!("[android-video] read ffmpeg stdout: {error}");
                break;
            }
        };
        stream.extend_from_slice(&buffer[..read]);

        let mut consumed = 0;
        let boundaries = start_code_offsets(&stream);
        for window in boundaries.windows(2) {
            let (start, code_length) = window[0];
            let end = window[1].0;
            let nal = &stream[start + code_length..end];
            consumed = end;
            if nal.is_empty() {
                continue;
            }
            let kind = crate::nal_type(nal);
            let starts_unit = kind == 9 || (pending_has_slice && matches!(kind, 1 | 5 | 6 | 7 | 8));
            if starts_unit && !pending.is_empty() {
                let _ = sender.send(std::mem::take(&mut pending));
                pending_has_slice = false;
            }
            pending.extend_from_slice(&[0, 0, 0, 1]);
            pending.extend_from_slice(nal);
            pending_has_slice |= matches!(kind, 1 | 5);
        }
        if consumed > 0 {
            stream.drain(..consumed);
        }
    }

    if !pending.is_empty() {
        let _ = sender.send(pending);
    }
}

fn start_code_offsets(data: &[u8]) -> Vec<(usize, usize)> {
    let mut offsets = Vec::new();
    let mut cursor = 0;
    while cursor + 3 <= data.len() {
        if data[cursor..].starts_with(&[0, 0, 0, 1]) {
            offsets.push((cursor, 4));
            cursor += 4;
        } else if data[cursor..].starts_with(&[0, 0, 1]) {
            offsets.push((cursor, 3));
            cursor += 3;
        } else {
            cursor += 1;
        }
    }
    offsets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffmpeg_does_not_share_the_cli_process_group() {
        let encoder = CliEncoder::new(64, 64).expect("start real ffmpeg");
        let parent_group = process_group(std::process::id());
        let ffmpeg_group = process_group(encoder.child.id());

        assert_ne!(parent_group, ffmpeg_group);
        assert_eq!(ffmpeg_group, encoder.child.id());
    }

    fn process_group(pid: u32) -> u32 {
        let output = Command::new("ps")
            .args(["-o", "pgid=", "-p", &pid.to_string()])
            .output()
            .expect("query process group");
        assert!(output.status.success());
        String::from_utf8(output.stdout)
            .unwrap()
            .trim()
            .parse()
            .unwrap()
    }
}
