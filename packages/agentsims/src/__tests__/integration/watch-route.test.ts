import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { encode as encodePng } from "fast-png";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { createProgram } from "../../cli/main";
import { makeDeviceService } from "../../core/tools/devices/devices";
import type { DeviceWatch } from "../../core/tools/observe/watch";
import type { PreviewServer } from "../../server/http/server";
import { androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { startTestServer } from "../helpers/server";

const DEVICE = "android:emulator-5554";
const servers: PreviewServer[] = [];

afterEach(() => {
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

async function startServer(labels: readonly string[][]) {
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
	const started = await startTestServer({ deviceCommands: service });
	servers.push(started.server);
	return started.origin;
}

describe("watch and wait routes", () => {
	test("returns the sampled frames and the contact sheet bytes over HTTP", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		const watch = (await client.watchDevice(DEVICE, {
			durationMs: 0,
			frames: 4,
		})) as DeviceWatch;

		expect(watch.device).toBe(DEVICE);
		expect(watch.platform).toBe("android");
		expect(watch.durationMs).toBe(0);
		expect(watch.requestedFrames).toBe(4);
		expect(watch.frames.map((frame) => frame.index)).toEqual([0, 1, 2, 3]);
		expect(watch.frames.every((frame) => frame.atMs >= 0)).toBe(true);
		expect(watch.sheet).toMatchObject({
			mimeType: "image/png",
			columns: 2,
			rows: 2,
			cellWidth: 40,
			cellHeight: 90,
		});
		expect(Buffer.isBuffer(watch.sheet?.bytes)).toBe(true);
		expect(watch.sheet!.bytes.byteLength).toBeGreaterThan(8);
		// The tree comes from the read after the last frame.
		expect(watch.observation.view?.nodes.length).toBeGreaterThan(0);
	});

	test("rejects a watch request outside the documented bounds", async () => {
		const origin = await startServer([]);
		const client = new ApplicationCommandClient({ origin });

		await expect(
			client.watchDevice(DEVICE, { durationMs: 0, frames: 99 }),
		).rejects.toMatchObject({ type: "InvalidCommandInput" });
		await expect(
			client.watchDevice(DEVICE, { durationMs: -5, frames: 2 }),
		).rejects.toMatchObject({ type: "InvalidCommandInput" });
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
			const sheets = readdirSync(directory);
			expect(sheets).toHaveLength(1);
			expect(printed).toContain("frames  4 over 0ms");
			expect(printed).toContain(`sheet=${join(directory, sheets[0]!)}`);
			expect(printed).toContain("grid=2x2 cell=40x90");
			expect(printed).toContain("frame  0  at=");
			expect(printed).toContain("- text");
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
