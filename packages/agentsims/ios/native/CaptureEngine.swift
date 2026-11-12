import Foundation
import CoreVideo
import CoreMedia
import os

// The capture + encode engine. Nothing is copied or encoded without a consumer:
// MJPEG encodes while MJPEG consumers exist, H.264 while AVCC consumers exist,
// and a static screen sends nothing to H.264 consumers. Encoded bytes (JPEG, or natively-framed AVCC
// envelopes) are handed back through a Swift closure on a native encode thread;
// the node-swift binding (sim-module.swift) marshals them onto the JS thread via
// a NodeAsyncQueue (threadsafe function).

struct Frame: Identifiable {
    let id = UUID()
    let pixelBuffer: CVPixelBuffer
    let nativeTiming: NativeFrameTiming?
}

protocol FrameEncoder {
    associatedtype Encoded
    func encode(_ frame: Frame) async throws -> Encoded
}

protocol CaptureConsuming: Sendable {
    // this is intentionally synchronous. CaptureEngine sends all frames to all consumers,
    // and lets them handle internal backpressure as they see fit. if instead this were async
    // (and CaptureEngine waited for all consumers to finish), a single bad consumer could
    // jam up the entire pipeline.
    func handleFrame(_ frame: Frame)
}

actor CaptureConsumer<E: FrameEncoder>: CaptureConsuming {
    nonisolated let continuation: AsyncStream<Frame>.Continuation

    init(
        encoder: E,
        onFrame: @escaping @isolated(any) (E.Encoded) async -> Void
    ) {
        let (stream, continuation) = AsyncStream.makeStream(
            of: Frame.self,
            // drop old frames if there's backpressure
            bufferingPolicy: .bufferingNewest(1)
        )
        self.continuation = continuation
        Task {
            _ = onFrame.isolation
            var lastError = ""
            var lastErrorAt = ContinuousClock.now - .seconds(10)
            for await frame in stream {
                do {
                    let encoded = try await encoder.encode(frame)
                    await onFrame(encoded)
                } catch {
                    if error is H264Encoder.FrameDropped { continue }
                    let message = String(describing: error)
                    let now = ContinuousClock.now
                    if message != lastError || now - lastErrorAt >= .seconds(5) {
                        print("error encoding frame: \(message)")
                        lastError = message
                        lastErrorAt = now
                    }
                    continue
                }
            }
        }
    }

    nonisolated func handleFrame(_ frame: Frame) {
        continuation.yield(frame)
    }

    deinit { continuation.finish() }
}

actor CaptureEngine {
    private enum Phase {
        case unstarted
        case starting
        case running
        case stopped
    }

    private let deviceUDID: String
    private let frameCapture = FrameCapture()
    private var phase = Phase.unstarted

    // mjpeg is stateless so we can share a single encoder instance
    private let mjpegEncoder = MJPEGEncoder()
    private let snapshotEncoder = VideoEncoder(quality: 0.7)

    private(set) var screenSize = Dimensions(width: 0, height: 0)
    private var consumers = [UUID: CaptureConsuming]()
    private var mjpegConsumers = Set<UUID>()
    private var avccEncoders = [UUID: AVCCEncoder]()
    /// The last copied frame. A new AVCC consumer or a keyframe request
    /// encodes it again, so a static screen still gets a keyframe at once.
    private var latestFrame: Frame?
    private var frameContinuation: AsyncStream<Frame>.Continuation?
    private var frameTask: Task<Void, Never>?

    init(deviceUDID: String) {
        self.deviceUDID = deviceUDID
    }

    /// Starts capture and returns the current surface size in device pixels.
    /// `onSize` receives later size changes, with or without consumers.
    func start(onSize: @escaping @Sendable (Int, Int) -> Void) async throws -> Dimensions {
        guard phase == .unstarted else { return await currentSize() }
        phase = .starting
        let (frames, frameContinuation) = AsyncStream.makeStream(
            of: Frame.self,
            // drop old frames if there's backpressure
            bufferingPolicy: .bufferingNewest(1)
        )
        do {
            try await frameCapture.start(
                deviceUDID: deviceUDID,
                onFrame: { pixelBuffer, _, nativeTiming in
                    frameContinuation.yield(Frame(pixelBuffer: pixelBuffer, nativeTiming: nativeTiming))
                },
                // Not through the frame stream: its newest-only buffer would let
                // an idle tick replace a pending frame.
                onIdle: { [weak self] in Task { await self?.reemitIdle() } },
                onSize: onSize
            )
        } catch {
            // A device that is still booting fails here. Allow a later retry.
            frameContinuation.finish()
            await frameCapture.stop()
            phase = .unstarted
            throw error
        }
        self.frameContinuation = frameContinuation
        frameTask = Task { [weak self] in
            for await frame in frames {
                guard let self else { return }
                await self.handleFrame(frame)
            }
        }
        phase = .running
        return await currentSize()
    }

    private func currentSize() async -> Dimensions {
        guard let size = await frameCapture.getScreenSize() else { return screenSize }
        return Dimensions(width: size.width, height: size.height)
    }

    /// JPEG of the framebuffer as it is now, at full device resolution.
    func snapshot() async throws -> (Data, Dimensions) {
        guard phase == .running else { throw Errors.notRunning }
        guard let pixelBuffer = await frameCapture.snapshot() else { throw Errors.noFrame }
        let data = try await snapshotEncoder.encode(pixelBuffer: pixelBuffer)
        return (data, pixelBuffer.dimensions)
    }

    private func updateDemand() async {
        await frameCapture.setDemand(frames: !consumers.isEmpty, idleReemit: !mjpegConsumers.isEmpty)
        if consumers.isEmpty { latestFrame = nil }
    }

    /// Give a new consumer the current frame without waiting for a change.
    /// `sameFrame` keeps the frame id, so MJPEG reuses the cached JPEG.
    private func seed(_ consumer: CaptureConsuming, sameFrame: Bool) async {
        if let latestFrame {
            consumer.handleFrame(sameFrame
                ? latestFrame
                : Frame(pixelBuffer: latestFrame.pixelBuffer, nativeTiming: nil))
        } else {
            await frameCapture.captureNow()
        }
    }

    private func addConsumer<E: FrameEncoder>(
        encoder: E,
        onFrame: sending @escaping @isolated(any) (E.Encoded) async -> Void
    ) async -> (@Sendable () async -> Void) {
        let consumer = CaptureConsumer(encoder: encoder) { [weak self] encoded in
            guard let self, await self.phase == .running else { return }
            await onFrame(encoded)
        }
        let id = UUID()
        consumers[id] = consumer
        mjpegConsumers.insert(id)
        let hadFrames = consumers.count > 1
        await updateDemand()
        if hadFrames { await seed(consumer, sameFrame: true) }
        return { await self.removeConsumer(id) }
    }

    private func removeConsumer(
        _ id: UUID
    ) async {
        consumers.removeValue(forKey: id)
        mjpegConsumers.remove(id)
        await updateDemand()
    }

    private func handleFrame(_ frame: Frame) {
        guard phase == .running, !consumers.isEmpty else { return }
        latestFrame = frame
        screenSize = frame.pixelBuffer.dimensions
        for consumer in consumers.values {
            consumer.handleFrame(frame)
        }
    }

    /// Send the last frame again to MJPEG consumers. The frame id is the
    /// same, so MJPEGEncoder returns the cached JPEG without encoding.
    private func reemitIdle() {
        guard phase == .running, let latestFrame else { return }
        for id in mjpegConsumers {
            consumers[id]?.handleFrame(latestFrame)
        }
    }

    func addMJPEGConsumer(
        onFrame: sending @escaping (Dimensions, Data) async -> Void
    ) async -> (@Sendable () async -> Void) {
        return await addConsumer(encoder: mjpegEncoder, onFrame: { [weak self] data in
            guard let self else { return }
            await onFrame(screenSize, data)
        })
    }

    /// `maxEdge` > 0 encodes at a size whose long edge is at most `maxEdge`
    /// pixels. 0 encodes at the full surface size.
    func addAVCCConsumer(
        maxEdge: Int,
        onFrame: sending @escaping (Dimensions, Data, Int32) async -> Void
    ) async -> (@Sendable () async -> Void) {
        let encoder = AVCCEncoder(maxEdge: maxEdge)
        let consumer = CaptureConsumer(encoder: encoder) { [weak self] encoded in
            let flagDescription: Int32 = 1 << 0
            let flagKeyframe: Int32 = 1 << 1

            guard let self else { return }
            if let description = encoded.frame.description {
                await onFrame(
                    screenSize,
                    AVCCEnvelope.description(avcc: description),
                    flagDescription,
                )
            }
            if let nativeTiming = encoded.nativeTiming {
                await onFrame(
                    screenSize,
                    AVCCEnvelope.simulatorFrameTiming(nativeTiming),
                    0,
                )
            }
            switch encoded.frame.kind {
            case .keyframe:
                await onFrame(
                    screenSize,
                    AVCCEnvelope.keyframe(avcc: encoded.frame.avcc),
                    flagKeyframe,
                )
            case .delta:
                await onFrame(
                    screenSize,
                    AVCCEnvelope.delta(avcc: encoded.frame.avcc),
                    0,
                )
            }
        }
        let id = UUID()
        let hadFrames = !consumers.isEmpty
        consumers[id] = consumer
        avccEncoders[id] = encoder
        await updateDemand()
        if hadFrames { await seed(consumer, sameFrame: false) }
        return { await self.removeAVCCConsumer(id) }
    }

    private func removeAVCCConsumer(_ id: UUID) async {
        consumers.removeValue(forKey: id)
        avccEncoders.removeValue(forKey: id)
        await updateDemand()
    }

    func requestAVCCKeyframe() async {
        let ids = Array(avccEncoders.keys)
        for id in ids {
            await avccEncoders[id]?.requestKeyframe()
        }
        // A static screen sends no new frame, so encode the last one again.
        if let latestFrame {
            for id in ids {
                consumers[id]?.handleFrame(Frame(pixelBuffer: latestFrame.pixelBuffer, nativeTiming: nil))
            }
        } else if !ids.isEmpty {
            await frameCapture.captureNow()
        }
    }

    func stop() async {
        if phase == .stopped { return }
        phase = .stopped
        frameContinuation?.finish()
        frameContinuation = nil
        frameTask?.cancel()
        frameTask = nil
        await frameCapture.stop()
        consumers.removeAll()
        mjpegConsumers.removeAll()
        latestFrame = nil
        let encoders = Array(avccEncoders.values)
        avccEncoders.removeAll()
        for encoder in encoders { await encoder.stop() }
    }

    enum Errors: Error {
        case notRunning
        case noFrame
    }
}

actor MJPEGEncoder: FrameEncoder {
    private let videoEncoder = VideoEncoder(quality: 0.7)
    private var lastImage: (UUID, Data)?

    init() {}

    func encode(_ frame: Frame) async throws -> Data {
        if let (id, data) = lastImage, id == frame.id { return data }
        let data = try await videoEncoder.encode(pixelBuffer: frame.pixelBuffer)
        lastImage = (frame.id, data)
        return data
    }
}

actor AVCCEncoder: FrameEncoder {
    private static let timeout: Duration = .milliseconds(500)

    let h264Encoder: H264Encoder
    var forceKeyframe = true

    init(maxEdge: Int = 0) {
        h264Encoder = H264Encoder(fps: 60, maxEdge: maxEdge)
    }

    struct Encoded {
        let frame: H264Encoder.Encoded
        let nativeTiming: NativeFrameTiming?
    }

    func encode(_ frame: Frame) async throws -> Encoded {
        // TODO: cancel after timeout using TaskGroup
        let result = try await h264Encoder.encode(
            frame.pixelBuffer,
            forceKeyframe: forceKeyframe,
        )
        forceKeyframe = false
        return Encoded(frame: result, nativeTiming: frame.nativeTiming)
    }

    func requestKeyframe() async {
        forceKeyframe = true
        await h264Encoder.reemitDescription()
    }

    func stop() async {
        await h264Encoder.stop()
    }

    deinit {
        Task { [h264Encoder] in await h264Encoder.stop() }
    }
}
