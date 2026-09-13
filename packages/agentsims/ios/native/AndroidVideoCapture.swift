import Accelerate
import CoreMedia
import CoreVideo
import Darwin
import Foundation

private let androidDescriptionFlag: Int32 = 1 << 0
private let androidKeyframeFlag: Int32 = 1 << 1

private struct AndroidFrameRequest: Sendable {
    let width: Int
    let height: Int
    var forceKeyframe: Bool
    let timestamp: CMTime
}

/// A one-element asynchronous mailbox. Replacing a frame carries its keyframe
/// request forward, so reconnect requests cannot disappear under backpressure.
private actor AndroidFrameMailbox {
    private var pending: AndroidFrameRequest?
    private var waiter: CheckedContinuation<AndroidFrameRequest?, Never>?
    private var forceNextKeyframe = true
    private var stopped = false

    func submit(width: Int, height: Int) {
        guard !stopped, width > 0, height > 0 else { return }
        var request = AndroidFrameRequest(
            width: width,
            height: height,
            forceKeyframe: forceNextKeyframe || (pending?.forceKeyframe ?? false),
            timestamp: CMClockGetTime(CMClockGetHostTimeClock())
        )
        forceNextKeyframe = false
        if let waiter {
            self.waiter = nil
            waiter.resume(returning: request)
        } else {
            // Keep the timestamp and dimensions from the newest notification.
            request.forceKeyframe = request.forceKeyframe || (pending?.forceKeyframe ?? false)
            pending = request
        }
    }

    func requestKeyframe() {
        if pending != nil {
            pending!.forceKeyframe = true
        } else {
            forceNextKeyframe = true
        }
    }

    func next() async -> AndroidFrameRequest? {
        if stopped { return nil }
        if let pending {
            self.pending = nil
            return pending
        }
        return await withCheckedContinuation { waiter = $0 }
    }

    func stop() {
        guard !stopped else { return }
        stopped = true
        pending = nil
        let waiter = self.waiter
        self.waiter = nil
        waiter?.resume(returning: nil)
    }
}

/// Read-only mapping of the emulator-owned live RGBA buffer. It is never passed
/// to VideoToolbox: each notification is copied and swizzled into private BGRA.
private final class AndroidRGBAMapping: @unchecked Sendable {
    private var fd: Int32
    private var address: UnsafeMutableRawPointer?
    private var length = 0

    init(path: String) throws {
        fd = open(path, O_RDONLY)
        guard fd >= 0 else { throw POSIXError(.ENOENT) }
    }

    deinit {
        dispose()
    }

    func dispose() {
        unmap()
        if fd >= 0 { close(fd) }
        fd = -1
    }

    func withBytes<T>(count: Int, _ body: (UnsafeRawBufferPointer) throws -> T) throws -> T {
        guard count > 0 else { throw Errors.invalidDimensions }
        if address == nil || count > length {
            unmap()
            var info = stat()
            guard fstat(fd, &info) == 0, info.st_size >= count else {
                throw Errors.bufferTooSmall
            }
            let mapped = mmap(nil, Int(info.st_size), PROT_READ, MAP_SHARED, fd, 0)
            guard mapped != MAP_FAILED else { throw Errors.couldNotMap }
            address = mapped
            length = Int(info.st_size)
        }
        return try body(UnsafeRawBufferPointer(start: address, count: count))
    }

    private func unmap() {
        if let address { munmap(address, length) }
        address = nil
        length = 0
    }

    enum Errors: Error { case invalidDimensions, bufferTooSmall, couldNotMap }
}

actor AndroidVideoEngine {
    typealias Output = @Sendable (Data, Int, Int, Int32) async -> Void

    private let mailbox = AndroidFrameMailbox()
    private let mapping: AndroidRGBAMapping
    private let encoder = H264Encoder(fps: 60, bitrate: 16_000_000)
    private let output: Output
    private var worker: Task<Void, Never>?
    private var pool: CVPixelBufferPool?
    private var poolDimensions: Dimensions?
    private var stopped = false

    init(path: String, output: @escaping Output) throws {
        mapping = try AndroidRGBAMapping(path: path)
        self.output = output
    }

    func start() {
        guard !stopped, worker == nil else { return }
        worker = Task { [weak self] in await self?.run() }
    }

    func frame(width: Int, height: Int) async { await mailbox.submit(width: width, height: height) }
    func requestKeyframe() async { await mailbox.requestKeyframe() }

    private func run() async {
        while let request = await mailbox.next() {
            if Task.isCancelled { break }
            do {
                let pixelBuffer = try makePrivateBuffer(request)
                if request.forceKeyframe { await encoder.reemitDescription() }
                let encoded = try await encoder.encode(
                    pixelBuffer,
                    forceKeyframe: request.forceKeyframe,
                    presentationTimeStamp: request.timestamp
                )
                guard !stopped else { break }
                if let description = encoded.description {
                    await output(
                        AVCCEnvelope.description(avcc: description),
                        request.width, request.height, androidDescriptionFlag
                    )
                }
                guard !stopped else { break }
                let keyframe = encoded.kind == .keyframe
                await output(
                    keyframe
                        ? AVCCEnvelope.keyframe(avcc: encoded.avcc)
                        : AVCCEnvelope.delta(avcc: encoded.avcc),
                    request.width, request.height,
                    keyframe ? androidKeyframeFlag : 0
                )
            } catch is H264Encoder.FrameDropped {
                continue
            } catch {
                print("[android-video] \(error)")
            }
        }
    }

    private func makePrivateBuffer(_ request: AndroidFrameRequest) throws -> CVPixelBuffer {
        let dimensions = Dimensions(width: request.width, height: request.height)
        if pool == nil || poolDimensions != dimensions {
            let attributes: [String: Any] = [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: request.width,
                kCVPixelBufferHeightKey as String: request.height,
                kCVPixelBufferIOSurfacePropertiesKey as String: [:],
            ]
            var next: CVPixelBufferPool?
            guard CVPixelBufferPoolCreate(nil, nil, attributes as CFDictionary, &next) == kCVReturnSuccess else {
                throw Errors.couldNotCreateBuffer
            }
            pool = next
            poolDimensions = dimensions
        }
        var result: CVPixelBuffer?
        guard let pool,
              CVPixelBufferPoolCreatePixelBuffer(nil, pool, &result) == kCVReturnSuccess,
              let result else { throw Errors.couldNotCreateBuffer }

        CVPixelBufferLockBaseAddress(result, [])
        defer { CVPixelBufferUnlockBaseAddress(result, []) }
        guard let destination = CVPixelBufferGetBaseAddress(result) else {
            throw Errors.couldNotCreateBuffer
        }
        let (pixelCount, pixelOverflow) = request.width.multipliedReportingOverflow(by: request.height)
        let (byteCount, byteOverflow) = pixelCount.multipliedReportingOverflow(by: 4)
        guard !pixelOverflow, !byteOverflow else { throw Errors.invalidDimensions }
        try mapping.withBytes(count: byteCount) { source in
            var src = vImage_Buffer(
                data: UnsafeMutableRawPointer(mutating: source.baseAddress!),
                height: vImagePixelCount(request.height), width: vImagePixelCount(request.width),
                rowBytes: request.width * 4
            )
            var dst = vImage_Buffer(
                data: destination,
                height: vImagePixelCount(request.height), width: vImagePixelCount(request.width),
                rowBytes: CVPixelBufferGetBytesPerRow(result)
            )
            let map: [UInt8] = [2, 1, 0, 3]
            guard vImagePermuteChannels_ARGB8888(&src, &dst, map, vImage_Flags(kvImageNoFlags)) == kvImageNoError else {
                throw Errors.copyFailed
            }
        }
        return result
    }

    func stop() async {
        guard !stopped else { return }
        stopped = true
        await mailbox.stop()
        worker?.cancel()
        await worker?.value
        worker = nil
        await encoder.stop()
        pool = nil
        mapping.dispose()
    }

    enum Errors: Error { case invalidDimensions, couldNotCreateBuffer, copyFailed }
}
