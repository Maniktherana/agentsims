import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { encode as encodePng } from "fast-png";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { createProgram } from "../../cli/main";
import { makeDeviceService } from "../../core/tools/devices/devices";
import type { ActionResult } from "../../core/tools/actions";
import type { DeviceWatch } from "../../core/tools/observe/watch";
import type { PreviewServer } from "../../server/http/server";
import { androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { startTestServer } from "../helpers/server";

const DEVICE = "android:emulator-5554";
const servers: PreviewServer[] = [];

afterEach(() => {
	// The CLI under test sets the exit code; never let it leak into bun test.
	process.exitCode = 0;
	for (const server of servers.splice(0)) server.stop();
});

function png(level: number, width = 40, height = 90): Buffer {
	return Buffer.from(
		encodePng({
			width,
			height,
			data: new Uint8Array(width * height * 3).fill(level),
			channels: 3,
			depth: 8,
		}),
	);
}

async function startServer(labels: readonly string[][], apps = false) {
	let reads = 0;
	let shots = 0;
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
				dispatchInputFrame: async () => {},
				captureScreenshot: async () => {
					shots += 1;
					return {
						bytes: png(shots * 20),
						mimeType: "image/png",
						capturedAt: Date.now(),
					};
				},
				readConfig: async () => ({
					width: 1080,
					height: 2400,
					orientation: "portrait",
				}),
				readAccessibility: async () => {
					const wanted = labels[Math.min(reads, labels.length - 1)];
					reads += 1;
					if (!wanted) return androidSignInSnapshot;
					return {
						screen: { width: 1080, height: 2400 },
						elements: wanted.map((label, index) => ({
							id: `node-${index}`,
							path: `0.${index}`,
							label,
							value: "",
							role: "android.widget.TextView",
							type: "android.widget.TextView",
							enabled: true,
							frame: { x: 0, y: 100 * index, width: 1080, height: 80 },
						})),
					};
				},
				performField: async () => null,
				readFocusedField: async () => null,
			}),
		() => Effect.succeed("com.example.app"),
	);
	const started = await startTestServer({
		deviceCommands: service,
		...(apps ? { apps: { execute: () => Effect.void } } : {}),
	});
	servers.push(started.server);
	return started.origin;
}

describe("watch and wait routes", () => {
	test("returns the sampled frames and the contact sheet bytes over HTTP", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		const watch = (await client.watchDevice(DEVICE, {
			durationMs: 0,
			samples: 4,
		})) as DeviceWatch;

		expect(watch.device).toBe(DEVICE);
		expect(watch.platform).toBe("android");
		expect(watch.durationMs).toBe(0);
		expect(watch.requestedSamples).toBe(4);
		expect(watch.frames.map((frame) => frame.index)).toEqual([0, 1, 2, 3]);
		expect(watch.frames.every((frame) => frame.atMs >= 0)).toBe(true);
		// The fake session has no live buffer, so the frames are screenshots.
		expect(watch.frames.every((frame) => frame.source === "screenshot")).toBe(
			true,
		);
		expect(watch.sheets).toHaveLength(1);
		expect(watch.sheets[0]).toMatchObject({
			index: 0,
			frames: [0, 1, 2, 3],
			columns: 4,
			rows: 1,
			cellWidth: 40,
			cellHeight: 90,
		});
		expect(Buffer.isBuffer(watch.sheets[0]!.png)).toBe(true);
		expect(watch.sheets[0]!.png.byteLength).toBeGreaterThan(8);
		// The tree comes from the read after the last frame.
		expect(watch.observation.view?.nodes.length).toBeGreaterThan(0);
	});

	test("pages many frames into sheets and keeps the frame PNGs", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		const watch = (await client.watchDevice(DEVICE, {
			durationMs: 0,
			everyMs: 50,
			keepFrames: true,
		})) as DeviceWatch;

		expect(watch.frames).toHaveLength(1);
		expect(Buffer.isBuffer(watch.frames[0]!.png)).toBe(true);

		const sampled = (await client.watchDevice(DEVICE, {
			durationMs: 0,
			samples: 30,
		})) as DeviceWatch;

		expect(sampled.frames).toHaveLength(30);
		// 40x90 cells fit 45 columns across, so one sheet still holds 30.
		expect(sampled.sheets).toHaveLength(1);
		expect(sampled.sheets[0]!.frames).toHaveLength(30);
	});

	test("rejects a watch request outside the documented bounds", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		await expect(
			client.watchDevice(DEVICE, { durationMs: 0, samples: 601 }),
		).rejects.toMatchObject({ type: "InvalidCommandInput" });
		await expect(
			client.watchDevice(DEVICE, { durationMs: -5, samples: 2 }),
		).rejects.toMatchObject({ type: "InvalidCommandInput" });
		await expect(
			client.watchDevice(DEVICE, { durationMs: 1000, samples: 2, everyMs: 100 }),
		).rejects.toMatchObject({ type: "InvalidCommandInput" });
		// 200 frames is a big ask, and no longer an invalid one.
		expect(
			((await client.watchDevice(DEVICE, {
				durationMs: 0,
				samples: 200,
			})) as DeviceWatch).frames,
		).toHaveLength(200);
	});

	test("polls until the label appears and reports the poll count", async () => {
		const origin = await startServer([["Saving"], ["Saved"]]);
		const client = new ApplicationCommandClient({ origin });

		const wait = (await client.waitDevice(DEVICE, {
			for: "Saved",
			timeoutMs: 4000,
			intervalMs: 50,
		})) as { satisfied: boolean; polls: number; condition: unknown };

		expect(wait.satisfied).toBe(true);
		expect(wait.polls).toBe(2);
		expect(wait.condition).toEqual({ kind: "for", text: "Saved" });
	});

	test("reports an unmet condition without failing the request", async () => {
		const origin = await startServer([["Loading"]]);
		const client = new ApplicationCommandClient({ origin });

		const wait = (await client.waitDevice(DEVICE, {
			gone: "Loading",
			timeoutMs: 120,
			intervalMs: 50,
		})) as { satisfied: boolean; polls: number };

		expect(wait.satisfied).toBe(false);
		expect(wait.polls).toBeGreaterThanOrEqual(2);
	});

	test("rejects a wait without exactly one condition", async () => {
		const origin = await startServer([["Saved"]]);
		const client = new ApplicationCommandClient({ origin });

		await expect(client.waitDevice(DEVICE, {})).rejects.toMatchObject({
			type: "InvalidCommandInput",
		});
	});
});

describe("action watch route", () => {
	test("an action takes the sampling query and returns its frames", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		const result = (await client.actDevice(
			DEVICE,
			[{ type: "tap", target: "50%,50%" }],
			{ watch: { durationMs: 0, samples: 3 } },
		)) as ActionResult;

		expect(result.dispatch.status).toBe("accepted");
		expect(result.watch?.frames).toHaveLength(3);
		// Every frame is the whole screen; nothing is cropped.
		const widths = result.watch?.frames.map((frame) => frame.width) ?? [];
		expect(new Set(widths).size).toBe(1);
		expect(widths[0]).toBeGreaterThan(20);
		expect(result.watch?.sheets).toHaveLength(1);
		expect(Buffer.isBuffer(result.watch?.sheets[0]?.png)).toBe(true);
	});

	test("an app launch takes the same query and keeps its frames", async () => {
		const origin = await startServer([], true);
		const client = new ApplicationCommandClient({ origin });

		const result = (await client.app(DEVICE, "launch", "com.example.app", {
			watch: { durationMs: 0, everyMs: 50, keepFrames: true },
		})) as ActionResult;

		expect(result.watch?.frames).toHaveLength(1);
		expect(Buffer.isBuffer(result.watch?.frames[0]?.png)).toBe(true);
	});

	test("an action without a watch query returns no frames", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		const result = (await client.actDevice(DEVICE, [
			{ type: "tap", target: "50%,50%" },
		])) as ActionResult;

		expect(result.watch).toBeUndefined();
	});
});

describe("watch and wait commands", () => {
	test("observe --watch writes one sheet and wait exits 1 on a timeout", async () => {
		const directory = mkdtempSync(join(tmpdir(), "agentsims-watch-"));
		const origin = await startServer([["Loading"]]);
		const previousDirectory = process.env.AGENTSIMS_SCREENSHOT_DIR;
		const previousExit = process.exitCode;
		const lines: string[] = [];
		const output = spyOn(process.stdout, "write").mockImplementation(
			((text: string) => {
				lines.push(String(text));
				return true;
			}) as typeof process.stdout.write,
		);
		process.env.AGENTSIMS_SCREENSHOT_DIR = directory;
		try {
			process.exitCode = 0;
			await createProgram()
				.exitOverride()
				.parseAsync(
					["observe", "-d", DEVICE, "--url", origin, "--watch", "0", "--samples", "4"],
					{ from: "user" },
				);
			const printed = lines.join("");
			const written = readdirSync(directory);
			expect(written).toHaveLength(1);
			expect(printed).toContain("frames  4 over 0ms  source=screenshot");
			expect(printed).toContain(
				`sheet  0  frames=0\u20133  grid=4x1  cell=40x90  path=${join(directory, written[0]!)}`,
			);
			expect(printed).not.toContain("frame  0  at=");
			expect(printed).toContain("- text");
			expect(process.exitCode).toBe(0);

			lines.length = 0;
			await createProgram()
				.exitOverride()
				.parseAsync(
					[
						"observe",
						"-d",
						DEVICE,
						"--url",
						origin,
						"--watch",
						"0",
						"--samples",
						"2",
						"--keep-frames",
					],
					{ from: "user" },
				);
			const kept = lines.join("");
			// One sheet and one file per frame.
			expect(readdirSync(directory)).toHaveLength(1 + 1 + 2);
			expect(kept).toContain("frame  0  at=");
			expect(kept).toContain("frame  1  at=");

			lines.length = 0;
			await createProgram()
				.exitOverride()
				.parseAsync(
					[
						"tap",
						"50%,50%",
						"-d",
						DEVICE,
						"--url",
						origin,
						"--watch",
						"0",
						"--samples",
						"2",
					],
					{ from: "user" },
				);
			const tapped = lines.join("");
			expect(tapped).toContain("watch  2 frames  source=screenshot");
			expect(tapped).toContain(
				`sheet  0  frames=0\u20131  grid=2x1  cell=40x90  path=${directory}`,
			);
			expect(process.exitCode).toBe(0);

			lines.length = 0;
			await createProgram()
				.exitOverride()
				.parseAsync(
					[
						"wait",
						"-d",
						DEVICE,
						"--url",
						origin,
						"--for",
						"Saved",
						"--timeout",
						"120",
						"--interval",
						"50",
					],
					{ from: "user" },
				);
			const waited = lines.join("");
			expect(waited).toContain('wait  for="Saved"  satisfied=no');
			expect(waited).toContain("polls=");
			expect(waited).toContain('- text "Loading"');
			expect(process.exitCode).toBe(1);
		} finally {
			output.mockRestore();
			process.exitCode = previousExit;
			if (previousDirectory === undefined)
				delete process.env.AGENTSIMS_SCREENSHOT_DIR;
			else process.env.AGENTSIMS_SCREENSHOT_DIR = previousDirectory;
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
