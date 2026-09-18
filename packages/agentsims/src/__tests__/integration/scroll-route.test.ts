import { afterEach, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { makeDeviceService } from "../../core/tools/devices/devices";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import type { ScrollResult } from "../../core/tools/scroll";
import type { PreviewServer } from "../../server/http/server";
import { axElement } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer } from "../helpers/server";

const servers: PreviewServer[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const DEVICE = "android:emulator-5554";
const SCREEN = { width: 1080, height: 2400, orientation: "portrait" };
const IMAGE = usablePng(SCREEN.width, SCREEN.height);

function listPage(rows: readonly string[]): AxSnapshot {
	return {
		screen: { width: SCREEN.width, height: SCREEN.height },
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: "root",
				frame: { x: 0, y: 0, width: 1080, height: 2400 },
				windowId: 1,
				windowLayer: 1,
				windowActive: true,
			}),
			axElement("0.0", "androidx.recyclerview.widget.RecyclerView", {
				id: "tasks",
				testId: "com.example:id/tasks",
				traits: ["scrollable"],
				frame: { x: 0, y: 400, width: 1080, height: 1600 },
			}),
			...rows.map((row, index) =>
				axElement(`0.0.${index}`, "android.widget.TextView", {
					id: `row-${row}`,
					label: row,
					frame: { x: 0, y: 400 + index * 160, width: 1080, height: 120 },
				}),
			),
		],
	};
}

/** A fake device session stands in for the runner's platform host. */
async function start(pages: readonly AxSnapshot[]) {
	const frames: Array<Record<string, unknown>> = [];
	let swipes = 0;
	const service = makeDeviceService(
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
				dispatchInputFrame: async (data: Buffer) => {
					const frame = JSON.parse(data.subarray(1).toString());
					frames.push(frame);
					// A real screen changes when the finger lifts, not when it is
					// read, so the page advances once per completed swipe.
					if (frame.type === "end") swipes += 1;
				},
				captureScreenshot: async () => ({
					bytes: IMAGE,
					mimeType: "image/png",
					capturedAt: 1,
				}),
				readConfig: async () => SCREEN,
				readAccessibility: async () => pages[swipes] ?? pages.at(-1),
			}),
		() => Effect.succeed("com.example.app"),
	);
	const { origin, server } = await startTestServer({ deviceCommands: service });
	servers.push(server);
	return {
		origin,
		frames,
		client: new ApplicationCommandClient({ origin }),
	};
}

test("the scroll route reports the region, the swipe, and the runner result", async () => {
	const server = await start([listPage(["Alpha", "Beta"]), listPage(["Gamma"])]);

	const response = await fetch(
		`${server.origin}/device/${encodeURIComponent(DEVICE)}/scroll`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ direction: "down" }),
		},
	);

	expect(response.status).toBe(200);
	const result = (await response.json()) as ScrollResult;
	expect(result).toMatchObject({
		device: DEVICE,
		direction: "down",
		amount: 40,
		durationMs: 600,
		swipes: 1,
		pages: 1,
		endReached: false,
		from: { x: 540, y: 1520 },
		to: { x: 540, y: 880 },
		container: {
			role: "list",
			source: "scrollable",
			path: "0.0",
			box: { x: 0, y: 400, width: 1080, height: 1600 },
		},
	});
	expect(result.action.dispatch.status).toBe("accepted");
	expect(result.action.resolved[0]).toMatchObject({
		type: "swipe",
		from: { pixels: { x: 540, y: 1520 } },
		to: { pixels: { x: 540, y: 880 } },
	});
	// The swipe travels in 0-1 fractions, so no capture ID is needed.
	expect(server.frames.at(0)).toMatchObject({ type: "begin" });
	expect(server.frames.at(0)?.y).toBeCloseTo(1520 / 2400, 5);
	expect(server.frames.at(-1)).toMatchObject({ type: "end" });
	expect(server.frames.at(-1)?.y).toBeCloseTo(880 / 2400, 5);
});

test("the client collects every page of a list in one request", async () => {
	const server = await start([
		listPage(["Alpha", "Beta"]),
		listPage(["Beta", "Gamma"]),
		listPage(["Gamma", "Delta"]),
		listPage(["Gamma", "Delta"]),
	]);

	const result = (await server.client.scrollDevice(DEVICE, {
		direction: "down",
		toEnd: true,
		collect: "text",
	})) as ScrollResult;

	expect(result.pages).toBe(3);
	expect(result.endReached).toBe(true);
	expect(result.count).toBe(4);
	expect(result.items?.map((item) => item.text)).toEqual([
		"Alpha",
		"Beta",
		"Gamma",
		"Delta",
	]);
});

test("the route refuses an invalid scroll request before any input", async () => {
	const server = await start([listPage(["Alpha"])]);

	const response = await fetch(
		`${server.origin}/device/${encodeURIComponent(DEVICE)}/scroll`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ direction: "sideways" }),
		},
	);

	expect(response.status).toBe(400);
	expect(await response.json()).toMatchObject({ type: "InvalidCommandInput" });
	expect(server.frames).toEqual([]);
});
