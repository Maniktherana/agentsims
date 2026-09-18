import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import { createProgram } from "../../cli/main";
import { renderSequenceResult } from "../../cli/observe-output";
import { makeDeviceService, type DeviceService } from "../../core/tools/devices/devices";
import { runSequence, type SequenceResult } from "../../core/tools/sequence";
import type { AxSnapshot } from "../../core/tools/observe/accessibility-model";
import type { PreviewServer } from "../../server/http/server";
import { axElement } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer } from "../helpers/server";

const servers: PreviewServer[] = [];

afterEach(async () => {
	// The CLI under test sets the exit code; never let it leak into bun test.
	process.exitCode = 0;
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

const ANDROID = "android:emulator-5554";
const SCREEN = { width: 1080, height: 2400, orientation: "portrait" } as const;
const IMAGE = usablePng(SCREEN.width, SCREEN.height);

/** A screen of plain clickable buttons, one per label. */
function buttonTree(labels: readonly string[]): AxSnapshot {
	return {
		screen: { width: SCREEN.width, height: SCREEN.height },
		elements: [
			axElement("0", "android.widget.FrameLayout", {
				id: "root",
				frame: { x: 0, y: 0, width: SCREEN.width, height: SCREEN.height },
			}),
			...labels.map((label, index) =>
				axElement(`0.${index}`, "android.widget.Button", {
					id: `button-${index}`,
					label,
					traits: ["clickable"],
					frame: { x: 40, y: 200 + index * 200, width: 1000, height: 120 },
				}),
			),
		],
	};
}

type Behaviour = {
	/** One tree per accessibility read. The last one repeats. */
	trees?: AxSnapshot[];
};

async function start(behaviour: Behaviour = {}) {
	const frames: Array<{ device: string; input: unknown }> = [];
	const calls: string[] = [];
	let reads = 0;
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
		(device) =>
			Effect.succeed({
				platform: "android" as const,
				dispatchInputFrame: async (data: Buffer) => {
					frames.push({
						device,
						input: JSON.parse(data.subarray(1).toString()),
					});
				},
				captureScreenshot: async () => ({
					bytes: IMAGE,
					mimeType: "image/png",
					capturedAt: Date.now(),
					width: SCREEN.width,
					height: SCREEN.height,
				}),
				readConfig: async () => SCREEN,
				readAccessibility: async () => {
					const index = reads;
					reads += 1;
					const trees = behaviour.trees ?? [buttonTree(["One", "Two", "Three"])];
					return trees[index] ?? trees.at(-1)!;
				},
			}),
		() => Effect.succeed("com.example.app"),
	);
	/** Records the order of the two device operations a sequence uses. */
	const watched: DeviceService = {
		...service,
		observe: (device, options) =>
			Effect.suspend(() => {
				calls.push("observe");
				return service.observe(device, options);
			}),
		act: (device, values, options) =>
			Effect.suspend(() => {
				calls.push("act");
				return service.act(device, values, options);
			}),
	};
	const { origin, server } = await startTestServer({ deviceCommands: watched });
	servers.push(server);
	return {
		client: new ApplicationCommandClient({ origin }),
		origin,
		service: watched,
		frames,
		calls,
		reads: () => reads,
	};
}

const tapped = (frames: Array<{ input: unknown }>): number[] =>
	frames
		.map((frame) => (frame.input as { type: string; y?: number }))
		.filter((input) => input.type === "begin")
		.map((input) => Math.round((input.y ?? 0) * SCREEN.height));

test("a three-step sequence observes before every dispatch", async () => {
	const { client, calls, frames } = await start();

	const result = (await client.runSequence(ANDROID, [
		{ type: "tap", target: "One" },
		{ type: "tap", target: "Two" },
		{ type: "tap", target: "Three" },
	])) as SequenceResult;

	expect(result.device).toBe(ANDROID);
	expect(result.stoppedAt).toBeNull();
	expect(result.completed).toBe(3);
	expect(result.total).toBe(3);
	expect(result.steps).toHaveLength(3);
	for (const step of result.steps)
		expect(step.result.dispatch.status).toBe("accepted");
	expect(result.steps.map((step) => step.index)).toEqual([0, 1, 2]);
	expect(calls).toEqual([
		"observe",
		"act",
		"observe",
		"act",
		"observe",
		"act",
	]);
	expect(tapped(frames)).toEqual([260, 460, 660]);
});

test("each step resolves against the tree the last step left", async () => {
	// The second tree moves "Two" and adds a row above it. A stale tree would
	// send the finger to the first screen's coordinates.
	const { client, frames } = await start({
		trees: [
			buttonTree(["One", "Two"]),
			buttonTree(["One", "Two"]),
			buttonTree(["Added", "One", "Two"]),
			buttonTree(["Added", "One", "Two"]),
		],
	});

	const result = (await client.runSequence(ANDROID, [
		{ type: "tap", target: "Two" },
		{ type: "tap", target: "Two" },
	])) as SequenceResult;

	expect(result.stoppedAt).toBeNull();
	expect(tapped(frames)).toEqual([460, 660]);
});

test("a refused second step stops the run before the third", async () => {
	const { client, calls, frames } = await start({
		trees: [buttonTree(["One", "Three"])],
	});

	const result = (await client.runSequence(ANDROID, [
		{ type: "tap", target: "One" },
		{ type: "tap", target: "Two", label: "the missing row" },
		{ type: "tap", target: "Three" },
	])) as SequenceResult;

	expect(result.steps).toHaveLength(2);
	expect(result.stoppedAt).toBe(1);
	expect(result.completed).toBe(1);
	expect(result.total).toBe(3);
	expect(result.steps[0]?.result.dispatch.status).toBe("accepted");
	expect(result.steps[1]?.result.dispatch.status).toBe("none");
	expect(result.steps[1]?.result.dispatch.reason).toContain(
		'no node matches "Two"',
	);
	expect(result.steps[1]?.label).toBe("the missing row");
	expect(calls).toEqual(["observe", "act", "observe", "act"]);
	expect(tapped(frames)).toEqual([260]);
});

test("a wait step sleeps, reports accepted, and reads the tree after", async () => {
	const { client, frames } = await start();

	const result = (await client.runSequence(ANDROID, [
		{ type: "wait", ms: 20, label: "let the sheet settle" },
		{ type: "tap", target: "One" },
	])) as SequenceResult;

	expect(result.stoppedAt).toBeNull();
	expect(result.completed).toBe(2);
	expect(result.steps[0]?.result.dispatch.status).toBe("accepted");
	expect(result.steps[0]?.result.dispatch.reason).toBe("Waited 20 ms");
	expect(result.steps[0]?.result.verification.status).toBe("not_applicable");
	expect(result.steps[0]?.result.view?.id).toStartWith("s");
	expect(tapped(frames)).toEqual([260]);
});

test("the route rejects a ref target before it touches the device", async () => {
	const { client, frames, calls } = await start();

	await expect(
		client.runSequence(ANDROID, [
			{ type: "tap", target: "One" },
			{ type: "tap", target: "@e2" },
		]),
	).rejects.toThrow("refs are not stable across steps; use labels");
	expect(frames).toHaveLength(0);
	expect(calls).toEqual([]);
});

test("the route rejects more steps than the sequence limit", async () => {
	const { client } = await start();

	await expect(
		client.runSequence(
			ANDROID,
			Array.from({ length: 26 }, () => ({ type: "tap", target: "One" })),
		),
	).rejects.toThrow("A sequence takes at most 25 steps");
});

test("runSequence settles after an accepted step and skips the settle on stop", async () => {
	const slept: number[] = [];
	const operations = {
		observe: () => Effect.succeed({ view: null } as never),
		act: (_device: string, values: ReadonlyArray<unknown>) =>
			Effect.succeed({
				dispatch: {
					status:
						(values[0] as { target?: string }).target === "Missing"
							? ("none" as const)
							: ("accepted" as const),
					reason: "",
				},
			} as never),
	};

	const result = Effect.runSync(
		runSequence(
			operations,
			ANDROID,
			[
				{ type: "tap", target: "One" },
				{ type: "tap", target: "Missing" },
				{ type: "tap", target: "Two" },
			],
			{ sleep: (ms) => Effect.sync(() => void slept.push(ms)) },
		),
	);

	expect(result.stoppedAt).toBe(1);
	expect(result.completed).toBe(1);
	expect(slept).toEqual([400]);
});

test("the human output names every step and the reason it stopped", async () => {
	const { client } = await start({ trees: [buttonTree(["One", "Three"])] });

	const result = (await client.runSequence(ANDROID, [
		{ type: "tap", target: "One" },
		{ type: "tap", target: "Two" },
		{ type: "tap", target: "Three" },
	])) as SequenceResult;
	const lines = renderSequenceResult(result).split("\n");

	expect(lines[0]).toBe(
		'step 1/3  tap "One"  dispatch accepted  verification not_applicable',
	);
	expect(lines[1]).toBe(
		'step 2/3  tap "Two"  dispatch none  verification not_applicable',
	);
	expect(lines[2]).toStartWith('stopped at step 2: no node matches "Two"');
	expect(lines.slice(3).join("\n")).toContain("One");
});

test("a label replaces the action text in the output", async () => {
	const { client } = await start();

	const result = (await client.runSequence(ANDROID, [
		{ type: "tap", target: "One", label: "open the form" },
	])) as SequenceResult;

	expect(renderSequenceResult(result).split("\n")[0]).toBe(
		"step 1/1  open the form  dispatch accepted  verification not_applicable",
	);
});

function stepFile(steps: unknown): { file: string; remove: () => void } {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-run-"));
	const file = join(directory, "steps.json");
	writeFileSync(file, typeof steps === "string" ? steps : JSON.stringify(steps));
	return {
		file,
		remove: () => rmSync(directory, { recursive: true, force: true }),
	};
}

async function runCli(args: string[]): Promise<string> {
	const written: string[] = [];
	const output = spyOn(process.stdout, "write").mockImplementation((value) => {
		written.push(String(value));
		return true;
	});
	try {
		await createProgram().parseAsync(args, { from: "user" });
	} finally {
		output.mockRestore();
	}
	return written.join("");
}

test("the CLI runs a step file and exits 1 when the run stops early", async () => {
	const { origin, calls } = await start({
		trees: [buttonTree(["One", "Three"])],
	});
	const { file, remove } = stepFile([
		{ type: "tap", target: "One" },
		{ type: "tap", target: "Two" },
		{ type: "tap", target: "Three" },
	]);
	const previous = process.exitCode;
	try {
		const text = await runCli(["run", file, "-d", ANDROID, "--url", origin]);
		expect(process.exitCode).toBe(1);
		expect(text).toContain("stopped at step 2:");
	} finally {
		process.exitCode = previous;
		remove();
	}
	expect(calls).toEqual(["observe", "act", "observe", "act"]);
});

test("the CLI prints one step per line and leaves the exit code alone", async () => {
	const { origin } = await start();
	const { file, remove } = stepFile([
		{ type: "tap", target: "One" },
		{ type: "tap", target: "Two" },
	]);
	const previous = process.exitCode;
	try {
		const text = await runCli(["run", file, "-d", ANDROID, "--url", origin]);
		expect(process.exitCode).toBe(previous);
		expect(text).toContain('step 1/2  tap "One"  dispatch accepted');
		expect(text).toContain('step 2/2  tap "Two"  dispatch accepted');
		expect(text).not.toContain("stopped at step");
	} finally {
		process.exitCode = previous;
		remove();
	}
});

test("the CLI --json output keeps one entry per step without image bytes", async () => {
	const { origin } = await start();
	const { file, remove } = stepFile([{ type: "tap", target: "One" }]);
	let text: string;
	try {
		text = await runCli([
			"run",
			file,
			"-d",
			ANDROID,
			"--url",
			origin,
			"--json",
		]);
	} finally {
		remove();
	}
	const payload = JSON.parse(text) as {
		steps: Array<{ index: number; action: { type: string } }>;
		stoppedAt: number | null;
		total: number;
	};
	expect(payload.steps).toHaveLength(1);
	expect(payload.steps[0]?.action.type).toBe("tap");
	expect(payload.stoppedAt).toBeNull();
	expect(payload.total).toBe(1);
	expect(text).not.toContain("$agentsimsBytes");
});

test("the CLI rejects a ref target without calling the server", async () => {
	const { file, remove } = stepFile([{ type: "tap", target: "@e2" }]);
	try {
		await expect(
			createProgram().parseAsync(
				["run", file, "-d", ANDROID, "--url", "http://127.0.0.1:1"],
				{ from: "user" },
			),
		).rejects.toThrow("refs are not stable across steps; use labels");
	} finally {
		remove();
	}
});

test("the CLI explains a step file that is not JSON", async () => {
	const { file, remove } = stepFile("not json");
	try {
		await expect(
			createProgram().parseAsync(
				["run", file, "-d", ANDROID, "--url", "http://127.0.0.1:1"],
				{ from: "user" },
			),
		).rejects.toThrow("must hold a JSON array of steps");
	} finally {
		remove();
	}
});
