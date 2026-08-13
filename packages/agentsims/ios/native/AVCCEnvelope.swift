import Foundation

/// Bytes that wrap each chunk on the `/stream.avcc` wire. Every chunk is a
/// 4-byte big-endian length (covering the tag byte + payload) followed by a
/// one-byte tag and the payload:
///
/// - `0x01` description — avcC parameter-set blob (SPS/PPS); configures the
///   decoder. Emitted once per encoder session and replayed to late joiners.
/// - `0x02` keyframe — IDR (decoder can start here).
/// - `0x03` delta — non-IDR P-frame (depends on prior frames).
enum AVCCEnvelope {
    static let descriptionTag: UInt8 = 0x01
    static let keyframeTag: UInt8 = 0x02
    static let deltaTag: UInt8 = 0x03

    static func description(avcc: Data) -> Data { wrap(tag: descriptionTag, payload: avcc) }
    static func keyframe(avcc: Data) -> Data { wrap(tag: keyframeTag, payload: avcc) }
    static func delta(avcc: Data) -> Data { wrap(tag: deltaTag, payload: avcc) }

    private static func wrap(tag: UInt8, payload: Data) -> Data {
        let length = UInt32(payload.count + 1)
        var out = Data(capacity: 5 + payload.count)
        withUnsafeBytes(of: length.bigEndian) { out.append(contentsOf: $0) }
        out.append(tag)
        out.append(payload)
        return out
    }
}
