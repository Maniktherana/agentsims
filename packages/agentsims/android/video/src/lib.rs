use std::fs::File;
use std::sync::{
    Arc, Condvar, Mutex,
    atomic::{AtomicBool, Ordering},
};
use std::thread::{self, JoinHandle};

use ffmpeg::{
    Dictionary, Packet, Rational, codec, encoder, format, frame, picture, software::scaling,
    software::scaling::flag::Flags as ScalingFlags,
};
use ffmpeg_next as ffmpeg;
use memmap2::Mmap;
use napi::{
    Error, Result, Status,
    bindgen_prelude::{Buffer, Function},
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use napi_derive::napi;

const FPS: u32 = 60;
const BIT_RATE: usize = 16_000_000;
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

struct EncodedOutput {
    data: Vec<u8>,
    width: u32,
    height: u32,
    flags: u32,
}

type FrameCallback =
    ThreadsafeFunction<EncodedOutput, (), (Buffer, u32, u32, u32), Status, false, false, 4>;

struct EncoderState {
    width: u32,
    height: u32,
    scaler: scaling::Context,
    encoder: encoder::Video,
    source: frame::Video,
    converted: frame::Video,
    frame_index: i64,
    emitted_description: bool,
}

impl EncoderState {
    fn new(width: u32, height: u32) -> std::result::Result<Self, String> {
        ffmpeg::init().map_err(|error| format!("initialize FFmpeg: {error}"))?;

        let encoder_name = platform_encoder_name();
        let selected = encoder::find_by_name(encoder_name)
            .ok_or_else(|| format!("FFmpeg encoder {encoder_name} is unavailable"))?;
        let mut video = codec::context::Context::new_with_codec(selected)
            .encoder()
            .video()
            .map_err(|error| format!("create {encoder_name}: {error}"))?;
        video.set_width(width);
        video.set_height(height);
        video.set_format(format::Pixel::NV12);
        video.set_time_base(Rational(1, FPS as i32));
        video.set_frame_rate(Some(Rational(FPS as i32, 1)));
        video.set_bit_rate(BIT_RATE);
        video.set_gop(FPS * 5);
        video.set_max_b_frames(0);
        // FFmpeg's VideoToolbox backend only enables Apple's one-in/one-out
        // low-latency rate-control mode when AV_CODEC_FLAG_LOW_DELAY is set.
        // RealTime + zero B-frames alone still permits a decoder-sized DPB,
        // which makes visual feedback fall hundreds of milliseconds behind
        // input as the machine gets busy.
        video.set_flags(codec::Flags::LOW_DELAY);

        let mut options = Dictionary::new();
        configure_platform_encoder(&mut options);
        let encoder = video
            .open_as_with(selected, options)
            .map_err(|error| format!("open {encoder_name}: {error}"))?;
        let scaler = scaling::Context::get(
            format::Pixel::RGBA,
            width,
            height,
            format::Pixel::NV12,
            width,
            height,
            ScalingFlags::FAST_BILINEAR,
        )
        .map_err(|error| format!("create RGBA to NV12 converter: {error}"))?;

        Ok(Self {
            width,
            height,
            scaler,
            encoder,
            source: frame::Video::new(format::Pixel::RGBA, width, height),
            converted: frame::Video::new(format::Pixel::NV12, width, height),
            frame_index: 0,
            emitted_description: false,
        })
    }

    fn encode(
        &mut self,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> std::result::Result<Vec<EncodedOutput>, String> {
        let row_bytes = self.width as usize * 4;
        let required = row_bytes * self.height as usize;
        if rgba.len() < required {
            return Err(format!(
                "RGBA mmap is too small: need {required} bytes, found {}",
                rgba.len()
            ));
        }

        let source_stride = self.source.stride(0);
        let destination = self.source.data_mut(0);
        for row in 0..self.height as usize {
            let source_start = row * row_bytes;
            let destination_start = row * source_stride;
            destination[destination_start..destination_start + row_bytes]
                .copy_from_slice(&rgba[source_start..source_start + row_bytes]);
        }
        self.scaler
            .run(&self.source, &mut self.converted)
            .map_err(|error| format!("convert RGBA frame: {error}"))?;

        self.frame_index += 1;
        self.converted.set_pts(Some(self.frame_index));
        self.converted.set_kind(if force_keyframe {
            picture::Type::I
        } else {
            picture::Type::None
        });
        self.encoder
            .send_frame(&self.converted)
            .map_err(|error| format!("submit frame to encoder: {error}"))?;

        let mut outputs = Vec::new();
        let mut packet = Packet::empty();
        while self.encoder.receive_packet(&mut packet).is_ok() {
            let packet_data = packet
                .data()
                .ok_or_else(|| "FFmpeg returned an empty H.264 packet".to_string())?;
            let normalized = normalize_h264_packet(packet_data)?;
            if packet.is_key() && !self.emitted_description {
                if let Some(description) = avcc_description(&normalized.nals) {
                    self.emitted_description = true;
                    outputs.push(EncodedOutput {
                        data: envelope(AVCC_TAG_DESCRIPTION, &description),
                        width: self.width,
                        height: self.height,
                        flags: FLAG_DESCRIPTION,
                    });
                }
            }
            let payload = avcc_payload(&normalized.nals);
            if !payload.is_empty() {
                let keyframe = packet.is_key();
                outputs.push(EncodedOutput {
                    data: envelope(
                        if keyframe {
                            AVCC_TAG_KEYFRAME
                        } else {
                            AVCC_TAG_DELTA
                        },
                        &payload,
                    ),
                    width: self.width,
                    height: self.height,
                    flags: if keyframe { FLAG_KEYFRAME } else { 0 },
                });
            }
            packet = Packet::empty();
        }
        Ok(outputs)
    }
}

#[cfg(target_os = "macos")]
fn platform_encoder_name() -> &'static str {
    "h264_videotoolbox"
}

#[cfg(target_os = "linux")]
fn platform_encoder_name() -> &'static str {
    "libx264"
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn platform_encoder_name() -> &'static str {
    "libx264"
}

#[cfg(target_os = "macos")]
fn configure_platform_encoder(options: &mut Dictionary<'_>) {
    options.set("realtime", "1");
    options.set("prio_speed", "1");
    options.set("profile", "high");
    options.set("allow_sw", "0");
}

#[cfg(not(target_os = "macos"))]
fn configure_platform_encoder(options: &mut Dictionary<'_>) {
    options.set("preset", "ultrafast");
    options.set("tune", "zerolatency");
    options.set("profile", "high");
}

struct NormalizedPacket {
    nals: Vec<Vec<u8>>,
}

fn normalize_h264_packet(data: &[u8]) -> std::result::Result<NormalizedPacket, String> {
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

fn nal_type(nal: &[u8]) -> u8 {
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

fn envelope(tag: u8, payload: &[u8]) -> Vec<u8> {
    let mut encoded = Vec::with_capacity(payload.len() + 5);
    encoded.extend_from_slice(&((payload.len() + 1) as u32).to_be_bytes());
    encoded.push(tag);
    encoded.extend_from_slice(payload);
    encoded
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
    let mut encoder: Option<EncoderState> = None;
    while let Some(request) = mailbox.receive() {
        if request.width == 0 || request.height == 0 {
            continue;
        }
        if encoder.as_ref().is_none_or(|current| {
            current.width != request.width || current.height != request.height
        }) {
            match EncoderState::new(request.width, request.height) {
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
                        current.emitted_description = false;
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
    fn encoder_low_delay_flag_maps_to_ffmpeg_codec_contract() {
        assert_eq!(
            codec::Flags::LOW_DELAY.bits(),
            ffmpeg::ffi::AV_CODEC_FLAG_LOW_DELAY as u32,
        );
    }

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
    fn preserves_length_prefixed_avcc_nals() {
        let packet = [0, 0, 0, 3, 0x41, 0xaa, 0xbb];
        let normalized = normalize_h264_packet(&packet).unwrap();
        assert_eq!(avcc_payload(&normalized.nals), packet);
    }
}
