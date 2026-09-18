/**
 * Wire format of the agentsims `/stream.avcc` H.264 stream. The browser player
 * and the server-side recorder read the same bytes, so the tags, the chunk
 * type, and the demuxer live here. Keep this module pure: no Node imports, no
 * DOM, no WebCodecs.
 *
 * Each chunk is a 4-byte big-endian length (covering the tag byte + payload)
 * followed by a one-byte tag and the payload:
 *
 *   [len:u32-be][tag:u8][payload…]   where len === payload.length + 1
 *
 * Tags (kept in sync with the Swift `AVCCEnvelope`):
 *   0x01 description — avcC parameter-set blob (SPS/PPS); configures decoder
 *   0x02 keyframe    — IDR (decodable standalone)
 *   0x03 delta       — non-IDR P-frame
 *   0x04 seed        — JPEG painted before the first IDR decodes
 *   0x05 presentation — Android canonical presentation generation
 *   0x06 simulator-frame-timing — native simulator framebuffer sequence + timestamp
 */

export const AVCC_TAG_DESCRIPTION = 0x01;
export const AVCC_TAG_KEYFRAME = 0x02;
export const AVCC_TAG_DELTA = 0x03;
export const AVCC_TAG_SEED = 0x04;
export const AVCC_TAG_PRESENTATION = 0x05;
export const AVCC_TAG_SIMULATOR_FRAME_TIMING = 0x06;

export type AvccChunkType =
	| "description"
	| "keyframe"
	| "delta"
	| "seed"
	| "presentation"
	| "simulator-frame-timing";

export interface AvccChunk {
	type: AvccChunkType;
	/** Payload bytes (tag stripped). */
	payload: Uint8Array;
}

const TAG_TO_TYPE: Record<number, AvccChunkType | undefined> = {
	[AVCC_TAG_DESCRIPTION]: "description",
	[AVCC_TAG_KEYFRAME]: "keyframe",
	[AVCC_TAG_DELTA]: "delta",
	[AVCC_TAG_SEED]: "seed",
	[AVCC_TAG_PRESENTATION]: "presentation",
	[AVCC_TAG_SIMULATOR_FRAME_TIMING]: "simulator-frame-timing",
};

/**
 * Stateful demuxer that turns a byte stream into whole AVCC chunks. Feed it
 * each `Uint8Array` from the reader; it returns the chunks now fully buffered
 * and retains any trailing partial bytes for the next call.
 */
export class AvccDemuxer {
	// Growable accumulation buffer. `len` is the logical end of valid bytes;
	// `start` is the read cursor of already-consumed bytes. Appending in place
	// (amortised doubling) instead of rebuilding the whole buffer per chunk keeps
	// this O(bytes) overall rather than O(bytes²): a port-forward tunnel splits
	// each frame — keyframes especially — into many small, separately-delivered
	// reads, and the old per-chunk `new Uint8Array(...)` + double copy churned
	// enough throwaway buffers to freeze the tab. See the matching note in
	// `utils/mjpeg-frame-parser.ts`.
	private buffer = new Uint8Array(64 * 1024);
	private len = 0;
	private start = 0;

	private append(bytes: Uint8Array): void {
		if (this.len + bytes.length > this.buffer.length) {
			// Reclaim the consumed prefix first; only grow if still short.
			if (this.start > 0) {
				this.buffer.copyWithin(0, this.start, this.len);
				this.len -= this.start;
				this.start = 0;
			}
			if (this.len + bytes.length > this.buffer.length) {
				let cap = this.buffer.length;
				while (cap < this.len + bytes.length) cap *= 2;
				const grown = new Uint8Array(cap);
				grown.set(this.buffer.subarray(0, this.len));
				this.buffer = grown;
			}
		}
		this.buffer.set(bytes, this.len);
		this.len += bytes.length;
	}

	push(bytes: Uint8Array): AvccChunk[] {
		if (bytes.length > 0) this.append(bytes);

		const chunks: AvccChunk[] = [];
		const buf = this.buffer;
		while (this.len - this.start >= 4) {
			const o = this.start;
			// Big-endian u32; `>>> 0` keeps it unsigned (bit 31 would otherwise sign).
			const length =
				((buf[o]! << 24) |
					(buf[o + 1]! << 16) |
					(buf[o + 2]! << 8) |
					buf[o + 3]!) >>>
				0;
			// length covers the tag byte + payload; need that many bytes after the
			// 4-byte header before the chunk is complete.
			if (this.len - o - 4 < length) break;
			if (length < 1) {
				// Malformed (length must include the tag byte). Skip the header and
				// resync rather than spinning forever.
				this.start += 4;
				continue;
			}
			const tag = buf[o + 4]!;
			const type = TAG_TO_TYPE[tag];
			// Copy the payload out: the backing buffer is reused/compacted in place.
			if (type)
				chunks.push({ type, payload: buf.slice(o + 5, o + 4 + length) });
			this.start += 4 + length;
		}

		// Compact the consumed prefix so the buffer only holds the unparsed tail.
		if (this.start > 0) {
			if (this.start < this.len)
				this.buffer.copyWithin(0, this.start, this.len);
			this.len -= this.start;
			this.start = 0;
		}
		return chunks;
	}

	reset(): void {
		// Keep the allocated capacity; just drop any buffered bytes.
		this.len = 0;
		this.start = 0;
	}
}

/**
 * What a consumer of the wire must provide. The Android frame coordinator
 * reads `closed` and `bufferedBytes` for backpressure and calls `close` when
 * the device stream ends; the iOS session only calls `write`.
 */
export type AvccSink = {
	readonly closed: boolean;
	readonly bufferedBytes: number;
	write(chunk: Uint8Array): void;
	close(): void;
	onClose(callback: () => void): void;
	onDrain(callback: () => void): void;
};

/** Frame a payload back into one wire chunk. Tests and writers share it. */
export function avccEnvelope(tag: number, payload: Uint8Array): Uint8Array {
	const out = new Uint8Array(5 + payload.length);
	const length = payload.length + 1;
	out[0] = (length >>> 24) & 0xff;
	out[1] = (length >>> 16) & 0xff;
	out[2] = (length >>> 8) & 0xff;
	out[3] = length & 0xff;
	out[4] = tag;
	out.set(payload, 5);
	return out;
}

/**
 * Build the `VideoDecoder` codec string from an avcC description blob. The
 * 2nd–4th bytes are profile_idc / constraint flags / level_idc, yielding e.g.
 * `avc1.640028`.
 */
export function avcCodecString(description: Uint8Array): string {
	if (description.length < 4) return "avc1.42E01E";
	const hex2 = (b: number) => b.toString(16).padStart(2, "0");
	return (
		"avc1." +
		hex2(description[1]!) +
		hex2(description[2]!) +
		hex2(description[3]!)
	);
}

export type VideoSize = { width: number; height: number };

/** Reads bits out of an SPS with the emulation-prevention bytes removed. */
class BitReader {
	private position = 0;

	constructor(private readonly bytes: Uint8Array) {}

	bit(): number {
		const index = this.position >> 3;
		if (index >= this.bytes.length) throw new Error("SPS ended early");
		const value = (this.bytes[index]! >> (7 - (this.position & 7))) & 1;
		this.position += 1;
		return value;
	}

	bits(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) value = (value << 1) | this.bit();
		return value;
	}

	/** Exp-Golomb unsigned. */
	ue(): number {
		let zeros = 0;
		while (this.bit() === 0) {
			zeros += 1;
			if (zeros > 31) throw new Error("SPS holds an invalid code");
		}
		return zeros === 0 ? 0 : 2 ** zeros - 1 + this.bits(zeros);
	}

	/** Exp-Golomb signed. */
	se(): number {
		const value = this.ue();
		return value % 2 === 0 ? -(value / 2) : (value + 1) / 2;
	}
}

/** Strip the 0x000003 emulation prevention bytes from a NAL payload. */
function unescapeNal(nal: Uint8Array): Uint8Array {
	const out = new Uint8Array(nal.length);
	let length = 0;
	let zeros = 0;
	for (const byte of nal) {
		if (zeros >= 2 && byte === 0x03) {
			zeros = 0;
			continue;
		}
		out[length] = byte;
		length += 1;
		zeros = byte === 0 ? zeros + 1 : 0;
	}
	return out.subarray(0, length);
}

const HIGH_PROFILES = new Set([
	100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
]);

function skipScalingList(reader: BitReader, size: number): void {
	let lastScale = 8;
	let nextScale = 8;
	for (let index = 0; index < size; index += 1) {
		if (nextScale !== 0) {
			const delta = reader.se();
			nextScale = (lastScale + delta + 256) % 256;
		}
		lastScale = nextScale === 0 ? lastScale : nextScale;
	}
}

/** Picture size from one SPS NAL, cropping included. Null when unreadable. */
export function spsVideoSize(sps: Uint8Array): VideoSize | null {
	try {
		// Skip the one-byte NAL header, then read the sequence parameter set.
		const reader = new BitReader(unescapeNal(sps.subarray(1)));
		const profileIdc = reader.bits(8);
		reader.bits(8); // constraint flags + reserved
		reader.bits(8); // level_idc
		reader.ue(); // seq_parameter_set_id
		let chromaFormatIdc = 1;
		let separateColourPlane = 0;
		if (HIGH_PROFILES.has(profileIdc)) {
			chromaFormatIdc = reader.ue();
			if (chromaFormatIdc === 3) separateColourPlane = reader.bit();
			reader.ue(); // bit_depth_luma_minus8
			reader.ue(); // bit_depth_chroma_minus8
			reader.bit(); // qpprime_y_zero_transform_bypass_flag
			if (reader.bit() === 1) {
				const lists = chromaFormatIdc === 3 ? 12 : 8;
				for (let index = 0; index < lists; index += 1)
					if (reader.bit() === 1) skipScalingList(reader, index < 6 ? 16 : 64);
			}
		}
		reader.ue(); // log2_max_frame_num_minus4
		const pictureOrderType = reader.ue();
		if (pictureOrderType === 0) reader.ue();
		else if (pictureOrderType === 1) {
			reader.bit();
			reader.se();
			reader.se();
			const cycle = reader.ue();
			for (let index = 0; index < cycle; index += 1) reader.se();
		}
		reader.ue(); // max_num_ref_frames
		reader.bit(); // gaps_in_frame_num_value_allowed_flag
		const widthInMbs = reader.ue() + 1;
		const heightInMapUnits = reader.ue() + 1;
		const frameMbsOnly = reader.bit();
		if (frameMbsOnly === 0) reader.bit(); // mb_adaptive_frame_field_flag
		reader.bit(); // direct_8x8_inference_flag
		let cropLeft = 0;
		let cropRight = 0;
		let cropTop = 0;
		let cropBottom = 0;
		if (reader.bit() === 1) {
			cropLeft = reader.ue();
			cropRight = reader.ue();
			cropTop = reader.ue();
			cropBottom = reader.ue();
		}
		// ChromaArrayType 0 (monochrome or separate planes) crops in whole samples.
		const monochrome = chromaFormatIdc === 0 || separateColourPlane === 1;
		const cropUnitX = monochrome || chromaFormatIdc === 3 ? 1 : 2;
		const cropUnitY =
			(monochrome || chromaFormatIdc !== 1 ? 1 : 2) * (2 - frameMbsOnly);
		const width = widthInMbs * 16 - cropUnitX * (cropLeft + cropRight);
		const height =
			(2 - frameMbsOnly) * heightInMapUnits * 16 -
			cropUnitY * (cropTop + cropBottom);
		if (width <= 0 || height <= 0) return null;
		return { width, height };
	} catch {
		return null;
	}
}

/**
 * Picture size from an avcC decoder configuration record
 * (ISO 14496-15 §5.2.4.1). Rotation shows up here, so this beats the session
 * screen config.
 */
export function avcConfigVideoSize(description: Uint8Array): VideoSize | null {
	if (description.length < 7 || description[0] !== 1) return null;
	const count = description[5]! & 0x1f;
	let offset = 6;
	for (let index = 0; index < count; index += 1) {
		if (offset + 2 > description.length) return null;
		const length = (description[offset]! << 8) | description[offset + 1]!;
		offset += 2;
		if (offset + length > description.length || length === 0) return null;
		const size = spsVideoSize(description.subarray(offset, offset + length));
		if (size) return size;
		offset += length;
	}
	return null;
}
