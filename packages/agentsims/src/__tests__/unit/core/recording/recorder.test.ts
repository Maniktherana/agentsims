import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_PRESENTATION,
	AVCC_TAG_SEED,
	avcConfigVideoSize,
	avccEnvelope,
} from "../../../../core/stream/avcc-wire";
import {
	ScreenRecorder,
	segmentPath,
	type RecordingFile,
} from "../../../../core/tools/recording/recorder";
import {
	landscapeStream,
	portraitStream,
	type AvccFixture,
} from "../../../fixtures/avcc-streams";

const roots: string[] = [];

function temporaryRoot(): string {
	const value = mkdtempSync(join(tmpdir(), "agentsims-recorder-"));
	roots.push(value);
	return value;
}

afterEach(() => {
	for (const value of roots.splice(0)) rmSync(value, { recursive: true });
});

/** A clock the test steps by hand, so sample durations are exact. */
function clock(stepMs: number): () => number {
	let value = 1_000;
	return () => {
		const current = value;
		value += stepMs;
		return current;
	};
}

function tagOf(type: "keyframe" | "delta"): number {
	return type === "keyframe" ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA;
}

function feed(recorder: ScreenRecorder, fixture: AvccFixture): void {
	recorder.sink.write(avccEnvelope(AVCC_TAG_DESCRIPTION, fixture.description));
	for (const frame of fixture.frames)
		recorder.sink.write(avccEnvelope(tagOf(frame.type), frame.data));
}

/** Byte offset of a four-character box name. */
function boxAt(file: Uint8Array, name: string): number {
	const needle = [...name].map((character) => character.charCodeAt(0));
	for (let index = 0; index + needle.length <= file.length; index += 1)
		if (needle.every((byte, offset) => file[index + offset] === byte))
			return index;
	return -1;
}

/** Top-level MP4 boxes, in file order. */
function boxes(file: Uint8Array): string[] {
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const names: string[] = [];
	let offset = 0;
	while (offset + 8 <= file.length) {
		const size = view.getUint32(offset);
		names.push(
			String.fromCharCode(...file.subarray(offset + 4, offset + 8)),
		);
		if (size < 8) break;
		offset += size;
	}
	return names;
}

/** The sample size table of the single video track. */
function sampleSizes(file: Uint8Array): number[] {
	const marker = boxAt(file, "stsz");
	expect(marker).toBeGreaterThan(0);
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const count = view.getUint32(marker + 12);
	return Array.from({ length: count }, (_value, index) =>
		view.getUint32(marker + 16 + index * 4),
	);
}

/** Sample deltas from the time-to-sample table. */
function sampleDeltas(file: Uint8Array): number[] {
	const marker = boxAt(file, "stts");
	expect(marker).toBeGreaterThan(0);
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
	const entries = view.getUint32(marker + 8);
	const deltas: number[] = [];
	for (let index = 0; index < entries; index += 1) {
		const count = view.getUint32(marker + 12 + index * 8);
		const delta = view.getUint32(marker + 16 + index * 8);
		for (let repeat = 0; repeat < count; repeat += 1) deltas.push(delta);
	}
	return deltas;
}

test("the avcC description carries the picture size", () => {
	expect(avcConfigVideoSize(landscapeStream.description)).toEqual({
		width: 160,
		height: 120,
	});
	expect(avcConfigVideoSize(portraitStream.description)).toEqual({
		width: 120,
		height: 160,
	});
});

test("a wire stream becomes one playable MP4", async () => {
	const path = join(temporaryRoot(), "recording.mp4");
	const recorder = new ScreenRecorder({ path, now: clock(40) });
	// Nothing before the first keyframe belongs in the file.
	recorder.sink.write(avccEnvelope(AVCC_TAG_DELTA, new Uint8Array([1, 2, 3])));
	recorder.sink.write(
		avccEnvelope(AVCC_TAG_DESCRIPTION, landscapeStream.description),
	);
	recorder.sink.write(avccEnvelope(AVCC_TAG_SEED, new Uint8Array([0xff, 0xd8])));
	recorder.sink.write(
		avccEnvelope(
			AVCC_TAG_PRESENTATION,
			new TextEncoder().encode('{"generation":2}'),
		),
	);
	recorder.sink.write(avccEnvelope(AVCC_TAG_DELTA, new Uint8Array([4, 5, 6])));
	for (const frame of landscapeStream.frames)
		recorder.sink.write(avccEnvelope(tagOf(frame.type), frame.data));

	const summary = await recorder.finish();
	expect(summary.error).toBeNull();
	expect(summary.paths).toEqual([path]);
	expect(summary.frames).toBe(landscapeStream.frames.length);
	expect(summary.segments[0]).toMatchObject({ width: 160, height: 120 });
	expect(summary.durationMs).toBeGreaterThan(0);

	const file = new Uint8Array(readFileSync(path));
	expect(summary.bytes).toBe(file.length);
	expect(boxes(file)).toEqual(["ftyp", "mdat", "moov"]);
	const sizes = sampleSizes(file);
	expect(sizes.length).toBe(landscapeStream.frames.length);
	expect(sizes[0]).toBe(landscapeStream.frames[0]!.data.length);
	// Every sample lasts one clock step, so time only moves forwards.
	expect(sampleDeltas(file).every((delta) => delta > 0)).toBe(true);
});

test("a new description ends the segment and opens the next one", async () => {
	const root = temporaryRoot();
	const path = join(root, "recording.mp4");
	const recorder = new ScreenRecorder({ path, now: clock(40) });
	feed(recorder, landscapeStream);
	feed(recorder, portraitStream);
	const summary = await recorder.finish();

	expect(summary.paths).toEqual([path, join(root, "recording-2.mp4")]);
	expect(summary.segments.map((segment) => segment.frames)).toEqual([
		landscapeStream.frames.length,
		portraitStream.frames.length,
	]);
	expect(summary.segments.map((segment) => segment.width)).toEqual([160, 120]);
	expect(summary.segments.map((segment) => segment.height)).toEqual([120, 160]);
	expect(summary.frames).toBe(
		landscapeStream.frames.length + portraitStream.frames.length,
	);
	for (const segment of summary.segments) {
		const file = new Uint8Array(readFileSync(segment.path));
		expect(boxes(file)).toEqual(["ftyp", "mdat", "moov"]);
		expect(sampleSizes(file).length).toBe(segment.frames);
	}
});

test("a burst of frames still gives every sample its own time", async () => {
	const path = join(temporaryRoot(), "recording.mp4");
	// A clock that never moves: every frame arrives in the same instant.
	const recorder = new ScreenRecorder({ path, now: () => 1_000 });
	feed(recorder, landscapeStream);
	const summary = await recorder.finish();

	expect(summary.frames).toBe(landscapeStream.frames.length);
	const deltas = sampleDeltas(new Uint8Array(readFileSync(path)));
	expect(deltas.length).toBe(summary.frames);
	expect(deltas.every((delta) => delta > 0)).toBe(true);
	expect(summary.durationMs).toBeGreaterThanOrEqual(
		landscapeStream.frames.length - 1,
	);
});

test("a repeated description keeps one segment", async () => {
	const path = join(temporaryRoot(), "recording.mp4");
	const recorder = new ScreenRecorder({ path, now: clock(40) });
	feed(recorder, landscapeStream);
	recorder.sink.write(
		avccEnvelope(AVCC_TAG_DESCRIPTION, landscapeStream.description),
	);
	const summary = await recorder.finish();
	expect(summary.paths.length).toBe(1);
	expect(summary.frames).toBe(landscapeStream.frames.length);
});

test("the sink never waits for the disk", async () => {
	const writes: number[] = [];
	const file: RecordingFile = {
		path: "memory.mp4",
		write: (data) => {
			writes.push(data.length);
		},
		pending: 0,
		bytes: 0,
		close: async () => {},
	};
	const recorder = new ScreenRecorder({
		path: "/recordings/memory.mp4",
		now: clock(40),
		openFile: () => file,
	});
	let settled = false;
	void Promise.resolve().then(() => {
		settled = true;
	});
	feed(recorder, landscapeStream);
	// Muxing happened inside the same tick: the sink awaited nothing.
	expect(settled).toBe(false);
	expect(recorder.frames).toBe(landscapeStream.frames.length - 1);
	expect(recorder.sink.closed).toBe(false);
	expect(recorder.sink.bufferedBytes).toBeGreaterThan(0);
	await recorder.finish();
	expect(recorder.sink.bufferedBytes).toBe(0);
	expect(writes.length).toBeGreaterThan(0);
});

test("a lost device keeps the frames already written", async () => {
	const path = join(temporaryRoot(), "recording.mp4");
	const recorder = new ScreenRecorder({ path, now: clock(40) });
	feed(recorder, landscapeStream);
	recorder.sink.close();
	expect(recorder.endedReason).toBe("device_gone");
	expect(recorder.sink.closed).toBe(true);
	const summary = await recorder.finish();
	expect(summary.frames).toBe(landscapeStream.frames.length);
	expect(sampleSizes(new Uint8Array(readFileSync(path))).length).toBe(
		summary.frames,
	);
});

test("a stream with no readable size writes nothing", async () => {
	const path = join(temporaryRoot(), "recording.mp4");
	const recorder = new ScreenRecorder({ path, now: clock(40) });
	recorder.sink.write(
		avccEnvelope(AVCC_TAG_DESCRIPTION, new Uint8Array([1, 0x42, 0, 0x1e, 0xff])),
	);
	recorder.sink.write(avccEnvelope(AVCC_TAG_KEYFRAME, new Uint8Array([0, 1, 2])));
	const summary = await recorder.finish();
	expect(summary.paths).toEqual([]);
	expect(summary.frames).toBe(0);
	expect(summary.error).toBe("The recorder cannot read the video size.");
});

test("segment paths number from the second file", () => {
	expect(segmentPath("/tmp/a/recording.mp4", 0)).toBe("/tmp/a/recording.mp4");
	expect(segmentPath("/tmp/a/recording.mp4", 1)).toBe("/tmp/a/recording-2.mp4");
	expect(segmentPath("/tmp/a/recording.mp4", 2)).toBe("/tmp/a/recording-3.mp4");
});
