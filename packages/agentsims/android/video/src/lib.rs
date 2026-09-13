use std::fs::File;
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};

use memmap2::Mmap;
use napi::{
    Error, Result, Status,
    bindgen_prelude::{Buffer, Function},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

mod cli_encoder;

pub(crate) const FPS: u32 = 60;
pub(crate) const BIT_RATE: usize = 16_000_000;
const FLAG_DESCRIPTION: u32 = 1 << 0;
const FLAG_KEYFRAME: u32 = 1 << 1;
const AVCC_TAG_DESCRIPTION: u8 = 0x01;
const AVCC_TAG_KEYFRAME: u8 = 0x02;
const AVCC_TAG_DELTA: u8 = 0x03;

#[derive(Clone, Copy)]
struct FrameRequest {
    width: u32,
    height: u32,
    force_keyframe: bool,
}

struct MailboxState {
    pending: Option<FrameRequest>,
    stopped: bool,
}

struct Mailbox {
    state: Mutex<MailboxState>,
    ready: Condvar,
}

impl Mailbox {
    fn new() -> Self {
        Self {
            state: Mutex::new(MailboxState {
                pending: None,
                stopped: false,
            }),
            ready: Condvar::new(),
        }
    }

    fn submit(&self, mut next: FrameRequest) {
        let mut state = self.state.lock().expect("android video mailbox poisoned");
        if state.stopped {
            return;
        }
        if let Some(previous) = state.pending {
            next.force_keyframe |= previous.force_keyframe;
        }
        state.pending = Some(next);
        self.ready.notify_one();
    }

    fn receive(&self) -> Option<FrameRequest> {
        let mut state = self.state.lock().expect("android video mailbox poisoned");
        while state.pending.is_none() && !state.stopped {
            state = self
                .ready
                .wait(state)
                .expect("android video mailbox poisoned while waiting");
        }
        if state.stopped {
            None
        } else {
            state.pending.take()
        }
    }

    fn stop(&self) {
        let mut state = self.state.lock().expect("android video mailbox poisoned");
        state.stopped = true;
        state.pending = None;
        self.ready.notify_all();
    }
}

pub(crate) struct EncodedOutput {
    pub(crate) data: Vec<u8>,
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) flags: u32,
}

/// Backend that turns an RGBA frame into AVCC output. The native backend links
/// libavcodec directly; the CLI backend pipes frames through the `ffmpeg`
/// binary. See `cli_encoder` for why both exist.
pub(crate) trait VideoEncoder {
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn encode(
        &mut self,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> std::result::Result<Vec<EncodedOutput>, String>;
}

type FrameCallback =
    ThreadsafeFunction<EncodedOutput, (), (Buffer, u32, u32, u32), Status, false, false, 4>;

pub(crate) struct NormalizedPacket {
    pub(crate) nals: Vec<Vec<u8>>,
}

pub(crate) fn normalize_h264_packet(data: &[u8]) -> std::result::Result<NormalizedPacket, String> {
    let nals = if has_annex_b_start_code(data) {
        split_annex_b(data)
    } else {
        split_avcc(data)?
    };
    if nals.is_empty() {
        return Err("H.264 packet contained no NAL units".to_string());
    }
    Ok(NormalizedPacket { nals })
}

fn has_annex_b_start_code(data: &[u8]) -> bool {
    data.starts_with(&[0, 0, 1]) || data.starts_with(&[0, 0, 0, 1])
}

fn start_code_at(data: &[u8], offset: usize) -> Option<usize> {
    if data.get(offset..offset + 4) == Some(&[0, 0, 0, 1]) {
        Some(4)
    } else if data.get(offset..offset + 3) == Some(&[0, 0, 1]) {
        Some(3)
    } else {
        None
    }
}

fn split_annex_b(data: &[u8]) -> Vec<Vec<u8>> {
    let mut starts = Vec::new();
    let mut cursor = 0;
    while cursor + 3 <= data.len() {
        if let Some(length) = start_code_at(data, cursor) {
            starts.push((cursor, length));
            cursor += length;
        } else {
            cursor += 1;
        }
    }
    let mut nals = Vec::new();
    for (index, (start, code_length)) in starts.iter().copied().enumerate() {
        let nal_start = start + code_length;
        let nal_end = starts.get(index + 1).map_or(data.len(), |next| next.0);
        if nal_start < nal_end {
            nals.push(data[nal_start..nal_end].to_vec());
        }
    }
    nals
}

fn split_avcc(data: &[u8]) -> std::result::Result<Vec<Vec<u8>>, String> {
    let mut nals = Vec::new();
    let mut cursor = 0;
    while cursor < data.len() {
        if cursor + 4 > data.len() {
            return Err("truncated AVCC NAL length".to_string());
        }
        let length = u32::from_be_bytes(data[cursor..cursor + 4].try_into().unwrap()) as usize;
        cursor += 4;
        if length == 0 || cursor + length > data.len() {
            return Err("invalid AVCC NAL length".to_string());
        }
        nals.push(data[cursor..cursor + length].to_vec());
        cursor += length;
    }
    Ok(nals)
}

pub(crate) fn nal_type(nal: &[u8]) -> u8 {
    nal.first().copied().unwrap_or(0) & 0x1f
}

fn avcc_payload(nals: &[Vec<u8>]) -> Vec<u8> {
    let mut payload = Vec::new();
    for nal in nals {
        if matches!(nal_type(nal), 7 | 8 | 9) {
            continue;
        }
        payload.extend_from_slice(&(nal.len() as u32).to_be_bytes());
        payload.extend_from_slice(nal);
    }
    payload
}

fn avcc_description(nals: &[Vec<u8>]) -> Option<Vec<u8>> {
    let sps = nals.iter().find(|nal| nal_type(nal) == 7)?;
    let pps = nals.iter().find(|nal| nal_type(nal) == 8)?;
    if sps.len() < 4 || sps.len() > u16::MAX as usize || pps.len() > u16::MAX as usize {
        return None;
    }
    let mut description = Vec::with_capacity(11 + sps.len() + pps.len());
    description.extend_from_slice(&[1, sps[1], sps[2], sps[3], 0xff, 0xe1]);
    description.extend_from_slice(&(sps.len() as u16).to_be_bytes());
    description.extend_from_slice(sps);
    description.push(1);
    description.extend_from_slice(&(pps.len() as u16).to_be_bytes());
    description.extend_from_slice(pps);
    Some(description)
}

pub(crate) fn encoded_packet_outputs(
    packet: &NormalizedPacket,
    keyframe: bool,
    width: u32,
    height: u32,
) -> Vec<EncodedOutput> {
    let mut outputs = Vec::new();
    if keyframe {
        if let Some(description) = avcc_description(&packet.nals) {
            outputs.push(EncodedOutput {
                data: envelope(AVCC_TAG_DESCRIPTION, &description),
                width,
                height,
                flags: FLAG_DESCRIPTION,
            });
        }
    }
    let payload = avcc_payload(&packet.nals);
    if !payload.is_empty() {
        outputs.push(EncodedOutput {
            data: envelope(
                if keyframe { AVCC_TAG_KEYFRAME } else { AVCC_TAG_DELTA },
                &payload,
            ),
            width,
            height,
            flags: if keyframe { FLAG_KEYFRAME } else { 0 },
        });
    }
    outputs
}

fn envelope(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(payload.len() + 5);
    encoded.extend_from_slice(&((payload.len() + 1) as u32).to_be_bytes());
    encoded.push(tag);
    encoded.extend_from_slice(payload);
    encoded
}

fn new_encoder(width: u32, height: u32) -> std::result::Result<Box<dyn VideoEncoder>, String> {
    Ok(Box::new(cli_encoder::CliEncoder::new(width, height)?))
}

fn worker(
    path: String,
    mailbox: Arc<Mailbox>,
    callback: FrameCallback,
    callback_dropped: Arc<AtomicBool>,
) {
    let file = match File::open(&path) {
        Ok(file) => file,
        Err(error) => {
            eprintln!("[android-video] open {path}: {error}");
            return;
        }
    };
    let mmap = match unsafe { Mmap::map(&file) } {
        Ok(mmap) => mmap,
        Err(error) => {
            eprintln!("[android-video] mmap {path}: {error}");
            return;
        }
    };
    let mut encoder: Option<Box<dyn VideoEncoder>> = None;
    while let Some(request) = mailbox.receive() {
        if request.width == 0 || request.height == 0 {
            continue;
        }
        if encoder.as_ref().is_none_or(|current| {
            current.width() != request.width || current.height() != request.height
        }) {
            match new_encoder(request.width, request.height) {
                Ok(next) => encoder = Some(next),
                Err(error) => {
                    eprintln!("[android-video] {error}");
                    encoder = None;
                    continue;
                }
            }
        }
        let Some(current) = encoder.as_mut() else {
            continue;
        };
        match current.encode(&mmap, request.force_keyframe) {
            Ok(outputs) => {
                for output in outputs {
                    let status = callback.call(output, ThreadsafeFunctionCallMode::NonBlocking);
                    if status != Status::Ok {
                        callback_dropped.store(true, Ordering::Release);
                        break;
                    }
                }
            }
            Err(error) => eprintln!("[android-video] {error}"),
        }
    }
}

#[napi]
pub struct AndroidVideoCapture {
    mailbox: Arc<Mailbox>,
    worker: Option<JoinHandle<()>>,
    force_keyframe: AtomicBool,
    callback_dropped: Arc<AtomicBool>,
}

#[napi]
impl AndroidVideoCapture {
    #[napi(constructor)]
    pub fn new(path: String, on_frame: Function<'_, (Buffer, u32, u32, u32), ()>) -> Result<Self> {
        let callback = on_frame
            .build_threadsafe_function::<EncodedOutput>()
            .max_queue_size::<4>()
            .build_callback(|context| {
                Ok((
                    Buffer::from(context.value.data),
                    context.value.width,
                    context.value.height,
                    context.value.flags,
                ))
            })?;
        let mailbox = Arc::new(Mailbox::new());
        let callback_dropped = Arc::new(AtomicBool::new(false));
        let worker_mailbox = Arc::clone(&mailbox);
        let worker_dropped = Arc::clone(&callback_dropped);
        let worker = thread::Builder::new()
            .name("agentsims-android-video".to_string())
            .spawn(move || worker(path, worker_mailbox, callback, worker_dropped))
            .map_err(|error| Error::new(Status::GenericFailure, error.to_string()))?;
        Ok(Self {
            mailbox,
            worker: Some(worker),
            force_keyframe: AtomicBool::new(true),
            callback_dropped,
        })
    }

    #[napi]
    pub fn frame(&self, width: u32, height: u32) {
        let force_keyframe = self.force_keyframe.swap(false, Ordering::AcqRel)
            || self.callback_dropped.swap(false, Ordering::AcqRel);
        self.mailbox.submit(FrameRequest {
            width,
            height,
            force_keyframe,
        });
    }

    #[napi(js_name = "requestKeyframe")]
    pub fn request_keyframe(&self) {
        self.force_keyframe.store(true, Ordering::Release);
    }

    #[napi]
    pub fn stop(&mut self) {
        self.stop_inner();
    }
}

impl AndroidVideoCapture {
    fn stop_inner(&mut self) {
        self.mailbox.stop();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

impl Drop for AndroidVideoCapture {
    fn drop(&mut self) {
        self.stop_inner();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

        #[test]
    fn mailbox_keeps_only_latest_frame_and_preserves_keyframe_request() {
        let mailbox = Mailbox::new();
        mailbox.submit(FrameRequest {
            width: 100,
            height: 200,
            force_keyframe: true,
        });
        mailbox.submit(FrameRequest {
            width: 300,
            height: 400,
            force_keyframe: false,
        });
        let request = mailbox.receive().unwrap();
        assert_eq!((request.width, request.height), (300, 400));
        assert!(request.force_keyframe);
    }

    #[test]
    fn mailbox_stop_unblocks_worker_receive() {
        let mailbox = Arc::new(Mailbox::new());
        let worker_mailbox = Arc::clone(&mailbox);
        let worker = thread::spawn(move || worker_mailbox.receive());

        mailbox.stop();

        assert!(worker.join().unwrap().is_none());
    }

    #[test]
    fn normalizes_annex_b_and_builds_avcc_description_and_payload() {
        let packet = [
            0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0xaa, 0, 0, 1, 0x68, 0xee, 0x3c, 0x80, 0, 0, 1, 0x65,
            1, 2, 3,
        ];
        let normalized = normalize_h264_packet(&packet).unwrap();
        let description = avcc_description(&normalized.nals).unwrap();
        assert_eq!(&description[..6], &[1, 0x64, 0, 0x28, 0xff, 0xe1]);
        let payload = avcc_payload(&normalized.nals);
        assert_eq!(payload, [0, 0, 0, 4, 0x65, 1, 2, 3]);
    }

    #[test]
    fn every_keyframe_carries_a_decoder_description_for_reconnects() {
        let packet = [
            0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 0xaa,
            0, 0, 1, 0x68, 0xee, 0x3c, 0x80,
            0, 0, 1, 0x65, 1, 2, 3,
        ];
        let normalized = normalize_h264_packet(&packet).unwrap();

        for _reconnect in 0..2 {
            let outputs = encoded_packet_outputs(&normalized, true, 1080, 2424);
            assert_eq!(outputs.len(), 2);
            assert_eq!(outputs[0].flags, FLAG_DESCRIPTION);
            assert_eq!(outputs[0].data[4], AVCC_TAG_DESCRIPTION);
            assert_eq!(outputs[1].flags, FLAG_KEYFRAME);
            assert_eq!(outputs[1].data[4], AVCC_TAG_KEYFRAME);
        }
    }

    #[test]
    fn preserves_length_prefixed_avcc_nals() {
        let packet = [0, 0, 0, 3, 0x41, 0xaa, 0xbb];
        let normalized = normalize_h264_packet(&packet).unwrap();
        assert_eq!(avcc_payload(&normalized.nals), packet);
    }
}

/// Measures the linked-libavcodec backend against the `ffmpeg` CLI backend on
/// synthetic frames, so the cost of the subprocess and pipe copy can be seen
/// without a running emulator. Ignored by default because it spawns encoders
/// and takes seconds.
///
///   cargo test --release --lib -- --ignored --nocapture encoder_backend_benchmark
#[cfg(test)]
mod bench {
    use super::*;
    use std::time::{Duration, Instant};

    const SOURCE_FRAMES: usize = 4;

    #[test]
    #[ignore]
    fn encoder_backend_benchmark() {
        let width = env_number("BENCH_WIDTH", 1080);
        let height = env_number("BENCH_HEIGHT", 2400);
        let frames = env_number("BENCH_FRAMES", 300) as usize;
        let pace = env_number("BENCH_FPS", FPS);

        let cadence = if pace == 0 {
            "unpaced".to_string()
        } else {
            format!("paced at {pace} fps")
        };
        println!("\n{width}x{height}, {frames} frames, {cadence}\n");
        let sources = build_sources(width, height);

        match run(width, height, frames, pace, &sources) {
            Ok(report) => report.print("ffmpeg cli"),
            Err(error) => println!("failed: {error}"),
        }
    }

    fn env_number(name: &str, fallback: u32) -> u32 {
        std::env::var(name)
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(fallback)
    }

    /// Moving content, so the encoder is not measured on a static image it can
    /// compress away to nothing.
    fn build_sources(width: u32, height: u32) -> Vec<Vec<u8>> {
        (0..SOURCE_FRAMES)
            .map(|index| {
                let offset = index * 37;
                let mut frame = vec![0u8; width as usize * height as usize * 4];
                for y in 0..height as usize {
                    for x in 0..width as usize {
                        let pixel = (y * width as usize + x) * 4;
                        frame[pixel] = ((x + offset) % 256) as u8;
                        frame[pixel + 1] = ((y * 3 + offset * 2) % 256) as u8;
                        frame[pixel + 2] = ((x ^ (y + offset)) % 256) as u8;
                        frame[pixel + 3] = 255;
                    }
                }
                frame
            })
            .collect()
    }

    struct Report {
        calls: Vec<Duration>,
        /// Frames submitted but not yet returned, sampled after every call.
        /// The native backend encodes inline so this stays at zero; the CLI
        /// backend encodes in another process, so this is its added latency.
        lag: Vec<usize>,
        wall: Duration,
        outputs: usize,
        bytes: usize,
        first_output_after: Option<usize>,
    }

    impl Report {
        fn print(&self, backend: &str) {
            let mut sorted = self.calls.clone();
            sorted.sort();
            let total: Duration = sorted.iter().sum();
            let mean = total / sorted.len().max(1) as u32;
            let at = |quantile: f64| {
                sorted[((sorted.len() as f64 * quantile) as usize).min(sorted.len() - 1)]
            };
            println!("{backend}");
            println!("  encode() mean {:>8.2} ms", mean.as_secs_f64() * 1000.0);
            println!("  encode() p50  {:>8.2} ms", at(0.50).as_secs_f64() * 1000.0);
            println!("  encode() p95  {:>8.2} ms", at(0.95).as_secs_f64() * 1000.0);
            println!("  encode() max  {:>8.2} ms", at(1.0).as_secs_f64() * 1000.0);
            println!(
                "  throughput    {:>8.1} fps",
                self.calls.len() as f64 / self.wall.as_secs_f64()
            );
            let mut lag = self.lag.clone();
            lag.sort();
            let mean_lag = self.lag.iter().sum::<usize>() as f64 / self.lag.len().max(1) as f64;
            let p95_lag = lag[((lag.len() as f64 * 0.95) as usize).min(lag.len() - 1)];
            println!("  lag mean      {mean_lag:>8.1} frames");
            println!("  lag p95       {p95_lag:>8} frames");
            println!("  outputs       {:>8}", self.outputs);
            println!("  encoded       {:>8.2} MB", self.bytes as f64 / 1_048_576.0);
            match self.first_output_after {
                Some(frames) => println!("  first output  {frames:>8} frames in"),
                None => println!("  first output     never"),
            }
            println!();
        }
    }

    fn run(
        width: u32,
        height: u32,
        frames: usize,
        pace: u32,
        sources: &[Vec<u8>],
    ) -> std::result::Result<Report, String> {
        let interval = if pace == 0 {
            Duration::ZERO
        } else {
            Duration::from_secs_f64(1.0 / pace as f64)
        };
        let mut encoder = new_encoder(width, height)?;
        let mut calls = Vec::with_capacity(frames);
        let mut lag = Vec::with_capacity(frames);
        let mut outputs = 0usize;
        let mut bytes = 0usize;
        let mut first_output_after = None;

        let wall_start = Instant::now();
        for index in 0..frames {
            let source = &sources[index % sources.len()];
            let deadline = wall_start + interval * index as u32;
            if let Some(wait) = deadline.checked_duration_since(Instant::now()) {
                std::thread::sleep(wait);
            }
            let start = Instant::now();
            let produced = encoder.encode(source, index == 0)?;
            calls.push(start.elapsed());
            for output in &produced {
                if output.flags & FLAG_DESCRIPTION == 0 {
                    outputs += 1;
                    first_output_after.get_or_insert(index + 1);
                }
                bytes += output.data.len();
            }
            lag.push((index + 1).saturating_sub(outputs));
        }

        Ok(Report {
            calls,
            lag,
            wall: wall_start.elapsed(),
            outputs,
            bytes,
            first_output_after,
        })
    }
}
