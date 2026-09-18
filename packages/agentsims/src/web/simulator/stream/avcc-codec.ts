/**
 * Browser half of the agentsims `/stream.avcc` H.264 stream.
 *
 * The wire format itself — the tags, the chunk type, and `AvccDemuxer` — is
 * shared with the server-side recorder in `core/stream/avcc-wire.ts` and is
 * re-exported here. This module keeps the parts only the player needs: the
 * Android and simulator metadata payloads and the WebCodecs support checks.
 */

export {
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_DELTA,
	AVCC_TAG_SEED,
	AVCC_TAG_PRESENTATION,
	AVCC_TAG_SIMULATOR_FRAME_TIMING,
	AvccDemuxer,
	avcCodecString,
	type AvccChunk,
	type AvccChunkType,
} from "../../../core/stream/avcc-wire";

export type AndroidFramePresentation = {
	generation: number;
};

export function parseAndroidFramePresentation(
	payload: Uint8Array,
): AndroidFramePresentation | null {
	try {
		const value = JSON.parse(
			new TextDecoder().decode(payload),
		) as Partial<AndroidFramePresentation>;
		if (!Number.isSafeInteger(value.generation) || value.generation! < 1)
			return null;
		return { generation: value.generation! };
	} catch {
		return null;
	}
}

export type SimulatorFrameTiming = {
	sequence: bigint;
	timestampUs: bigint;
};

export function parseSimulatorFrameTiming(
	payload: Uint8Array,
): SimulatorFrameTiming | null {
	if (payload.length !== 16) return null;
	const view = new DataView(
		payload.buffer,
		payload.byteOffset,
		payload.byteLength,
	);
	return {
		sequence: view.getBigUint64(0, false),
		timestampUs: view.getBigUint64(8, false),
	};
}

/** True when the runtime can decode the AVCC stream (WebCodecs available). */
export function isAvccSupported(): boolean {
	return (
		typeof globalThis !== "undefined" &&
		typeof (globalThis as any).VideoDecoder !== "undefined"
	);
}
