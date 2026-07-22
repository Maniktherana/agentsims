import Foundation
import CoreVideo
import Accelerate
import Darwin

private final class AndroidMmapFrameSource: @unchecked Sendable {
    private let file: Int32
    private let address: UnsafeMutableRawPointer
    private let length: Int
    private var pool: CVPixelBufferPool?
    private var poolDimensions: Dimensions?

    init(path: String) throws {
        file = Darwin.open(path, O_RDONLY)
        guard file >= 0 else { throw Errors.couldNotOpen }

        var stat = stat()
        guard fstat(file, &stat) == 0, stat.st_size > 0 else {
            Darwin.close(file)
            throw Errors.couldNotStat
        }
        length = Int(stat.st_size)
        let mapped = mmap(nil, length, PROT_READ, MAP_SHARED, file, 0)
        guard mapped != MAP_FAILED, let mapped else {
            Darwin.close(file)
            throw Errors.couldNotMap
        }
        address = mapped
    }

    deinit {
        munmap(address, length)
        Darwin.close(file)
    }

    private func pixelBufferPool(_ dimensions: Dimensions) -> CVPixelBufferPool? {
        if let pool, poolDimensions == dimensions { return pool }
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: dimensions.width,
            kCVPixelBufferHeightKey as String: dimensions.height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        var next: CVPixelBufferPool?
        guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attrs as CFDictionary, &next) == kCVReturnSuccess else {
            return nil
        }
        pool = next
        poolDimensions = dimensions
        return next
    }

    func copyFrame(width: Int, height: Int) -> CVPixelBuffer? {
        guard width > 0, height > 0, width * height * 4 <= length,
              let pool = pixelBufferPool(Dimensions(width: width, height: height)) else { return nil }

        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(kCFAllocatorDefault, pool, &pixelBuffer) == kCVReturnSuccess,
              let pixelBuffer else { return nil }

        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let destinationAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        var source = vImage_Buffer(
            data: address,
            height: vImagePixelCount(height),
            width: vImagePixelCount(width),
            rowBytes: width * 4
        )
        var destination = vImage_Buffer(
            data: destinationAddress,
            height: vImagePixelCount(height),
            width: vImagePixelCount(width),
            rowBytes: CVPixelBufferGetBytesPerRow(pixelBuffer)
        )
        let rgbaToBgra: [UInt8] = [2, 1, 0, 3]
        guard vImagePermuteChannels_ARGB8888(
            &source,
            &destination,
            rgbaToBgra,
            vImage_Flags(kvImageNoFlags)
        ) == kvImageNoError else { return nil }
        return pixelBuffer
    }

    enum Errors: Error {
        case couldNotOpen
        case couldNotStat
        case couldNotMap
    }
}

private struct AndroidFrameRequest: Sendable {
    let dimensions: Dimensions
    let forceKeyframe: Bool
}

final class AndroidMmapEncoder: @unchecked Sendable {
    private let continuation: AsyncStream<AndroidFrameRequest>.Continuation
    private let task: Task<Void, Never>

    init(
        path: String,
        onFrame: @escaping @Sendable (Dimensions, Data, Int32) async -> Void
    ) throws {
        let source = try AndroidMmapFrameSource(path: path)
        let (stream, continuation) = AsyncStream.makeStream(
            of: AndroidFrameRequest.self,
            bufferingPolicy: .bufferingNewest(1)
        )
        self.continuation = continuation
        task = Task {
            // Native Android phone framebuffers are roughly 2.5 MP. Six Mbps
            // visibly softens small RN text during motion; localhost can carry
            // a higher real-time stream without a network tradeoff.
            let encoder = H264Encoder(fps: 60, bitrate: 16_000_000)
            for await request in stream {
                if Task.isCancelled { break }
                guard let pixelBuffer = source.copyFrame(
                    width: request.dimensions.width,
                    height: request.dimensions.height
                ) else { continue }
                do {
                    let encoded = try await encoder.encode(
                        pixelBuffer,
                        forceKeyframe: request.forceKeyframe
                    )
                    let dimensions = pixelBuffer.dimensions
                    if let description = encoded.description {
                        await onFrame(
                            dimensions,
                            AVCCEnvelope.description(avcc: description),
                            1 << 0
                        )
                    }
                    switch encoded.kind {
                    case .keyframe:
                        await onFrame(
                            dimensions,
                            AVCCEnvelope.keyframe(avcc: encoded.avcc),
                            1 << 1
                        )
                    case .delta:
                        await onFrame(dimensions, AVCCEnvelope.delta(avcc: encoded.avcc), 0)
                    }
                } catch {
                    continue
                }
            }
            await encoder.stop()
        }
    }

    func submit(width: Int, height: Int, forceKeyframe: Bool) {
        continuation.yield(AndroidFrameRequest(
            dimensions: Dimensions(width: width, height: height),
            forceKeyframe: forceKeyframe
        ))
    }

    func stop() {
        continuation.finish()
        task.cancel()
    }

    deinit { stop() }
}
