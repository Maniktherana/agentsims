import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import {
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	avccEnvelope,
	type AvccSink,
} from "../../../../core/stream/avcc-wire";
import {
	makeRecordings,
	recordingPath,
	recordingsDirectory,
} from "../../../../core/tools/recording/recordings";
import type { DeviceAvccService } from "../../../../core/tools/devices/devices";
import { landscapeStream } from "../../../fixtures/avcc-streams";

const roots: string[] = [];

function temporaryRoot(): string {
	const value = mkdtempSync(join(tmpdir(), "agentsims-recordings-"));
	roots.push(value);
	return value;
}

afterEach(() => {
	for (const value of roots.splice(0)) rmSync(value, { recursive: true });
});

/** A device that hands the recorder one description and one keyframe. */
function fakeDevice(): DeviceAvccService & {
	sinks: AvccSink[];
	detached: number;
	play(): void;
} {
	const sinks: AvccSink[] = [];
	const service = {
		sinks,
		detached: 0,
		screenSize: () => Effect.succeed({ width: 160, height: 120 }),
		attach: (_device: string, sink: AvccSink) =>
			Effect.sync(() => {
				sinks.push(sink);
				return () => {
					service.detached += 1;
				};
			}),
		play: () => {
			for (const sink of sinks) {
				sink.write(
					avccEnvelope(AVCC_TAG_DESCRIPTION, landscapeStream.description),
				);
				sink.write(
					avccEnvelope(AVCC_TAG_KEYFRAME, landscapeStream.frames[0]!.data),
				);
			}
		},
	};
	return service;
}

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

test("the default path lands in the recordings directory", () => {
	const at = new Date("2026-01-02T03:04:05.678Z");
	const path = recordingPath("ios:ABC-123", undefined, at);
	expect(path).toBe(
		join(
			recordingsDirectory(),
			"recording-ios_ABC-123-2026-01-02T03-04-05-678Z.mp4",
		),
	);
	expect(recordingsDirectory()).toBe(
		join(tmpdir(), "agentsims", "recordings"),
	);
});

test("--out takes a file or a directory", () => {
	const at = new Date("2026-01-02T03:04:05.678Z");
	expect(recordingPath("ios:A", "/tmp/run/clip.mp4", at)).toBe(
		"/tmp/run/clip.mp4",
	);
	expect(recordingPath("ios:A", "/tmp/run", at)).toBe(
		"/tmp/run/recording-ios_A-2026-01-02T03-04-05-678Z.mp4",
	);
});

test("start, status, and stop follow one recording", async () => {
	const out = join(temporaryRoot(), "clip.mp4");
	const device = fakeDevice();
	const recordings = makeRecordings(device);

	const started = await run(recordings.start("ios:A", { out }));
	expect(started).toMatchObject({ device: "ios:A", path: out });
	expect(device.sinks.length).toBe(1);

	device.play();
	const active = await run(recordings.status("ios:A"));
	expect(active.recording).toMatchObject({ path: out, ended: null });

	const stopped = await run(recordings.stop("ios:A"));
	expect(stopped).toMatchObject({ device: "ios:A", paths: [out], frames: 1 });
	expect(stopped.bytes).toBeGreaterThan(0);
	expect(device.detached).toBe(1);
	expect(existsSync(out)).toBe(true);
	expect((await run(recordings.status("ios:A"))).recording).toBeNull();
});

test("a second start on the same device is a conflict", async () => {
	const out = join(temporaryRoot(), "clip.mp4");
	const recordings = makeRecordings(fakeDevice());
	await run(recordings.start("ios:A", { out }));
	const exit = await Effect.runPromiseExit(recordings.start("ios:A", { out }));
	expect(Exit.isFailure(exit)).toBe(true);
	if (Exit.isFailure(exit))
		expect(String(exit.cause)).toContain("already recording");
	// A different device records at the same time.
	await run(recordings.start("ios:B", { out: join(temporaryRoot(), "b.mp4") }));
	await run(recordings.stop("ios:A"));
	await run(recordings.stop("ios:B"));
});

test("stop without a recording is not found", async () => {
	const recordings = makeRecordings(fakeDevice());
	const exit = await Effect.runPromiseExit(recordings.stop("ios:A"));
	expect(Exit.isFailure(exit)).toBe(true);
	if (Exit.isFailure(exit))
		expect(String(exit.cause)).toContain("is not recording");
});

test("a lost device shows in the status and in the stop result", async () => {
	const out = join(temporaryRoot(), "clip.mp4");
	const device = fakeDevice();
	const recordings = makeRecordings(device);
	await run(recordings.start("ios:A", { out }));
	device.play();
	device.sinks[0]!.close();
	expect((await run(recordings.status("ios:A"))).recording).toMatchObject({
		ended: "device_gone",
	});
	const stopped = await run(recordings.stop("ios:A"));
	expect(stopped.ended).toBe("device_gone");
	expect(stopped.frames).toBe(1);
});

test("stopAll finalizes every open recording", async () => {
	const root = temporaryRoot();
	const device = fakeDevice();
	const recordings = makeRecordings(device);
	await run(recordings.start("ios:A", { out: join(root, "a.mp4") }));
	await run(recordings.start("ios:B", { out: join(root, "b.mp4") }));
	device.play();
	await recordings.stopAll();
	expect(existsSync(join(root, "a.mp4"))).toBe(true);
	expect(existsSync(join(root, "b.mp4"))).toBe(true);
	expect((await run(recordings.status("ios:A"))).recording).toBeNull();
});
