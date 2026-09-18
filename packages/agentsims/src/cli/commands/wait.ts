import { Command, InvalidArgumentError } from "commander";
import type {
	DeviceWait,
	DeviceWatch,
	FrameSampling,
} from "../../core/tools/observe/watch";
import {
	WAIT_DEFAULT_INTERVAL_MS,
	WAIT_DEFAULT_TIMEOUT_MS,
	WAIT_MAX_TIMEOUT_MS,
	WATCH_MAX_DURATION_MS,
	WATCH_MAX_SAMPLES,
	WATCH_MIN_EVERY_MS,
} from "../../core/tools/observe/watch";
import type { ApplicationCommandClient } from "../application-command-client";
import {
	renderWait,
	renderWatch,
	waitForOutput,
	watchForOutput,
	type ArtifactWrite,
	type ObserveFormat,
	type WatchArtifacts,
} from "../observe-output";
import { writeScreenshotFile, type ScreenshotKind } from "../screenshots";

/**
 * `watch` and `wait` are the timed half of observation. They share this
 * module because both block for a bounded time and then print a tree.
 */
export type WaitCommandDependencies = {
	client: (url?: string, timeoutMs?: number) => ApplicationCommandClient;
	json: (value: unknown) => void;
	write?: (text: string) => void;
};

/** Leave the server time to answer after its own deadline passes. */
const CLIENT_GRACE_MS = 15_000;

export type WatchFlags = {
	device: string;
	url?: string;
	watch: number;
	samples?: number;
	every?: number;
	region?: string;
	keepFrames?: boolean;
	out?: string;
	json?: boolean;
} & ObserveFormat;

export type WaitFlags = {
	device: string;
	url?: string;
	for?: string;
	gone?: string;
	stable?: boolean;
	timeout: number;
	interval: number;
	json?: boolean;
} & ObserveFormat;

const boundedInteger =
	(name: string, minimum: number, maximum: number) =>
	(value: string): number => {
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
			throw new InvalidArgumentError(
				`${name} must be an integer between ${minimum} and ${maximum}.`,
			);
		return parsed;
	};

export const watchDurationOption = boundedInteger(
	"Watch duration",
	0,
	WATCH_MAX_DURATION_MS,
);
export const watchSamplesOption = boundedInteger(
	"Sample count",
	1,
	WATCH_MAX_SAMPLES,
);
export const watchEveryOption = boundedInteger(
	"Sample interval",
	WATCH_MIN_EVERY_MS,
	WATCH_MAX_DURATION_MS,
);

function output(dependencies: WaitCommandDependencies, text: string): void {
	const write =
		dependencies.write ?? ((value: string) => process.stdout.write(value));
	write(`${text}\n`);
}

/** One file per sheet. A named path takes a suffix from the second sheet on. */
function numbered(path: string, index: number): string {
	if (index === 0) return path;
	const dot = path.lastIndexOf(".");
	const stop = dot > path.lastIndexOf("/") ? dot : path.length;
	return `${path.slice(0, stop)}-${index + 1}${path.slice(stop)}`;
}

function writeImage(
	kind: ScreenshotKind,
	device: string,
	content: Uint8Array,
	outputPath?: string,
): ArtifactWrite {
	try {
		return {
			status: "ok",
			path: writeScreenshotFile({
				kind,
				device,
				content,
				mimeType: "image/png",
				...(outputPath ? { outputPath } : {}),
			}),
		};
	} catch (error) {
		return {
			status: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Sheets and kept frames take the same artifact path, whether the sampling
 * came from `observe --watch` or from an action that watched its own effect.
 */
export function writeWatchArtifacts(
	device: string,
	sampling: FrameSampling,
	options: { kind?: ScreenshotKind; out?: string } = {},
): WatchArtifacts {
	const kind = options.kind ?? "observe";
	const out = options.out;
	const sheets = sampling.sheets.map((sheet, index) =>
		writeImage(kind, device, sheet.png, out ? numbered(out, index) : undefined),
	);
	const frames = sampling.frames.map((frame) =>
		frame.png
			? writeImage(
					kind,
					device,
					frame.png,
					out ? numbered(out, sampling.sheets.length + frame.index) : undefined,
				)
			: null,
	);
	return { sheets, frames };
}

/** An artifact that never reached the disk is a failed command. */
export function watchArtifactsFailed(artifacts: WatchArtifacts): boolean {
	return [...artifacts.sheets, ...artifacts.frames].some(
		(artifact) => artifact?.status === "error",
	);
}

/** `observe --watch` delegates here so the timed path stays in one module. */
export async function runObserveWatch(
	dependencies: WaitCommandDependencies,
	flags: WatchFlags,
): Promise<void> {
	const durationMs = flags.watch;
	const result = (await dependencies
		.client(flags.url, durationMs + CLIENT_GRACE_MS)
		.watchDevice(flags.device, {
			durationMs,
			...(flags.samples === undefined ? {} : { samples: flags.samples }),
			...(flags.every === undefined ? {} : { everyMs: flags.every }),
			...(flags.region === undefined ? {} : { region: flags.region }),
			...(flags.keepFrames ? { keepFrames: true } : {}),
		})) as DeviceWatch;
	const artifacts = writeWatchArtifacts(
		result.device,
		result,
		flags.out ? { out: flags.out } : {},
	);
	if (result.frames.length === 0 || watchArtifactsFailed(artifacts))
		process.exitCode = 1;
	if (flags.json) return dependencies.json(watchForOutput(result, artifacts));
	output(dependencies, renderWatch(result, artifacts, flags));
}

export function registerWaitCommands(
	program: Command,
	dependencies: WaitCommandDependencies,
): Command {
	program
		.command("wait")
		.description("Block until the screen shows, loses, or settles on a state")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--for <text>", "Wait until a label, value, or test ID appears")
		.option("--gone <text>", "Wait until a label, value, or test ID goes")
		.option("--stable", "Wait until two reads of the tree match")
		.option(
			"--timeout <ms>",
			"Give up after this long",
			boundedInteger("Timeout", 1, WAIT_MAX_TIMEOUT_MS),
			WAIT_DEFAULT_TIMEOUT_MS,
		)
		.option(
			"--interval <ms>",
			"Time between reads",
			boundedInteger("Interval", 50, WAIT_MAX_TIMEOUT_MS),
			WAIT_DEFAULT_INTERVAL_MS,
		)
		.option("--raw", "Print the platform class in place of the role")
		.option("--json", "Print structured output")
		.addHelpText(
			"after",
			`
Use wait in place of sleep. It exits 1 if the condition is not met.

Examples:
  agentsims wait --for "Saved" -d <id>
  agentsims wait --gone "Loading" --timeout 20000 -d <id>
  agentsims wait --stable -d <id>
`,
		)
		.action(async (flags: WaitFlags) => {
			const result = (await dependencies
				.client(flags.url, flags.timeout + CLIENT_GRACE_MS)
				.waitDevice(flags.device, {
					...(flags.for === undefined ? {} : { for: flags.for }),
					...(flags.gone === undefined ? {} : { gone: flags.gone }),
					...(flags.stable ? { stable: true } : {}),
					timeoutMs: flags.timeout,
					intervalMs: flags.interval,
				})) as DeviceWait;
			if (!result.satisfied) process.exitCode = 1;
			if (flags.json) return dependencies.json(waitForOutput(result));
			output(dependencies, renderWait(result, flags));
		});
	return program;
}
