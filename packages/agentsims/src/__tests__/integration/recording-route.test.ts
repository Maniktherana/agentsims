import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	avccEnvelope,
	type AvccSink,
} from "../../core/stream/avcc-wire";
import { makeRecordings } from "../../core/tools/recording/recordings";
import type { PreviewServer } from "../../server/http/server";
import { landscapeStream } from "../fixtures/avcc-streams";
import { startTestServer } from "../helpers/server";

const servers: PreviewServer[] = [];
const roots: string[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
	for (const value of roots.splice(0)) rmSync(value, { recursive: true });
});

const DEVICE = "ios:TEST-UDID";

/** The route talks to the real service; only the device wire is a fake. */
async function start() {
	const root = mkdtempSync(join(tmpdir(), "agentsims-recording-route-"));
	roots.push(root);
	const sinks: AvccSink[] = [];
	const recordings = makeRecordings({
		screenSize: () => Effect.succeed({ width: 160, height: 120 }),
		attach: (_device, sink) =>
			Effect.sync(() => {
				sinks.push(sink);
				return () => {};
			}),
	});
	const { origin, server } = await startTestServer({ recordings });
	servers.push(server);
	return {
		origin,
		root,
		client: new ApplicationCommandClient({ origin }),
		play: () => {
			for (const sink of sinks) {
				sink.write(
					avccEnvelope(AVCC_TAG_DESCRIPTION, landscapeStream.description),
				);
				for (const frame of landscapeStream.frames)
					sink.write(
						avccEnvelope(
							frame.type === "keyframe" ? AVCC_TAG_KEYFRAME : AVCC_TAG_DELTA,
							frame.data,
						),
					);
			}
		},
	};
}

const path = (suffix: string) =>
	`/device/${encodeURIComponent(DEVICE)}/recording${suffix}`;

test("the routes start, report, and finish one recording", async () => {
	const server = await start();
	const out = join(server.root, "clip.mp4");

	const started = (await server.client.startRecording(DEVICE, { out })) as {
		device: string;
		path: string;
		startedAt: string;
	};
	expect(started).toMatchObject({ device: DEVICE, path: out });
	expect(Date.parse(started.startedAt)).toBeGreaterThan(0);

	server.play();
	const status = (await server.client.recordingStatus(DEVICE)) as {
		recording: { path: string; frames: number } | null;
	};
	expect(status.recording).toMatchObject({ path: out });
	expect(status.recording!.frames).toBeGreaterThan(0);

	const stopped = (await server.client.stopRecording(DEVICE)) as {
		paths: string[];
		frames: number;
		bytes: number;
		durationMs: number;
	};
	expect(stopped.paths).toEqual([out]);
	expect(stopped.frames).toBe(landscapeStream.frames.length);
	expect(readFileSync(out).length).toBe(stopped.bytes);
	expect(
		((await server.client.recordingStatus(DEVICE)) as { recording: null })
			.recording,
	).toBeNull();
});

test("a second start answers 409 and a stop with nothing answers 404", async () => {
	const server = await start();
	const out = join(server.root, "clip.mp4");
	await server.client.startRecording(DEVICE, { out });

	const conflict = await fetch(`${server.origin}${path("/start")}`, {
		method: "POST",
	});
	expect(conflict.status).toBe(409);
	expect(await conflict.json()).toMatchObject({
		type: "CommandConflict",
		error: `Device ${DEVICE} is already recording.`,
	});

	await server.client.stopRecording(DEVICE);
	const missing = await fetch(`${server.origin}${path("/stop")}`, {
		method: "POST",
	});
	expect(missing.status).toBe(404);
	expect(await missing.json()).toMatchObject({ type: "CommandNotFound" });
});

test("a device with no recording reports none", async () => {
	const server = await start();
	const response = await fetch(`${server.origin}${path("")}`);
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ device: DEVICE, recording: null });
});
