import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { encode as encodePng } from "fast-png";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { makeDeviceService } from "../../core/tools/devices/devices";
import { makeTraceService } from "../../core/tools/traces/traces";
import type {
	TraceDocument,
	TraceSummary,
} from "../../core/tools/traces/trace-file";
import type { PreviewServer } from "../../server/http/server";
import { androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { startTestServer } from "../helpers/server";

const DEVICE = "android:trace-test";
const servers: PreviewServer[] = [];
const roots: string[] = [];

afterEach(() => {
	process.exitCode = 0;
	for (const server of servers.splice(0)) server.stop();
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});

function png(): Buffer {
	return Buffer.from(
		encodePng({
			width: 4,
			height: 4,
			data: new Uint8Array(4 * 4 * 3).fill(120),
			channels: 3,
			depth: 8,
		}),
	);
}

async function startServer() {
	const root = mkdtempSync(join(tmpdir(), "agentsims-trace-route-"));
	roots.push(root);
	const devices = makeDeviceService(
		{
			memoryReport: async () => ({ ok: false }),
			page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
		},
		{
			start: async (device) => ({ error: null, device }),
			shutdown: async () => null,
			states: async () => [],
		},
		() =>
			Effect.succeed({
				platform: "android" as const,
				dispatchInputFrame: async () => {},
				captureScreenshot: async () => ({
					bytes: png(),
					mimeType: "image/png",
					capturedAt: Date.now(),
				}),
				readConfig: async () => ({
					width: 1080,
					height: 2400,
					orientation: "portrait",
				}),
				readAccessibility: async () => androidSignInSnapshot,
				performField: async () => null,
				readFocusedField: async () => null,
			}),
	);
	const started = await startTestServer({
		deviceCommands: devices,
		traces: makeTraceService(root, (device) =>
			devices.captureScreenshot(device),
		),
	});
	servers.push(started.server);
	return { origin: started.origin, root };
}

test("the trace routes record the commands between start and stop", async () => {
	const { origin, root } = await startServer();
	const client = new ApplicationCommandClient({ origin });

	expect(await client.traceStatus(DEVICE)).toEqual({
		device: DEVICE,
		active: null,
	});
	await client.observeDevice(DEVICE);

	const started = (await client.startTrace(DEVICE, "route check")) as {
		id: string;
	};
	await client.observeDevice(DEVICE);
	await client.actDevice(DEVICE, [{ type: "tap", target: "Nowhere at all" }]);
	expect(await client.traceStatus(DEVICE)).toMatchObject({
		device: DEVICE,
		active: { id: started.id, calls: 2 },
	});
	const stopped = (await client.stopTrace(DEVICE)) as { calls: number };
	expect(stopped.calls).toBe(2);

	const list = (await fetch(`${origin}/traces`).then((response) =>
		response.json(),
	)) as TraceSummary[];
	expect(list).toHaveLength(1);
	expect(
		await fetch(`${origin}/traces/directory`).then((response) => response.json()),
	).toEqual({ directory: root });
	expect(list[0]).toMatchObject({
		id: started.id,
		device: DEVICE,
		platform: "android",
		name: "route check",
		calls: 2,
	});

	const document = (await fetch(`${origin}/traces/${started.id}`).then(
		(response) => response.json(),
	)) as TraceDocument;
	// The observe before the start left no record.
	expect(document.calls.map((call) => [call.command, call.status])).toEqual([
		["observe", "ok"],
		["tap", "refused"],
	]);
	expect(document.calls[0]?.screenshot).toBe("screenshots/000001.png");

	const image = await fetch(
		`${origin}/traces/${started.id}/screenshots/000001.png`,
	);
	expect(image.status).toBe(200);
	expect(image.headers.get("content-type")).toBe("image/png");
	expect(image.headers.get("cache-control")).toContain("immutable");
	expect((await image.bytes()).byteLength).toBeGreaterThan(8);

	const missing = await fetch(
		`${origin}/traces/${started.id}/screenshots/000009.png`,
	);
	expect(missing.status).toBe(404);
	const traversal = await fetch(`${origin}/traces/..%2F..%2Fetc/passwd`);
	expect(traversal.ok).toBe(false);
});

test("a second start for one device is refused", async () => {
	const { origin } = await startServer();
	const client = new ApplicationCommandClient({ origin });
	await client.startTrace(DEVICE);
	await expect(client.startTrace(DEVICE)).rejects.toThrow(
		/already has an active trace/,
	);
	await client.stopTrace(DEVICE);
	await expect(client.stopTrace(DEVICE)).rejects.toThrow(/no active trace/);
});
