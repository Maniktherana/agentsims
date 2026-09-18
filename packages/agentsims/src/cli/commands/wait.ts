import { Command, InvalidArgumentError } from "commander";
import type { DeviceWait, DeviceWatch } from "../../core/tools/observe/watch";
import {
	WAIT_DEFAULT_INTERVAL_MS,
	WAIT_DEFAULT_TIMEOUT_MS,
	WAIT_MAX_TIMEOUT_MS,
	WATCH_MAX_DURATION_MS,
	WATCH_MAX_FRAMES,
} from "../../core/tools/observe/watch";
import type { ApplicationCommandClient } from "../application-command-client";
import {
	renderWait,
	renderWatch,
	waitForOutput,
	watchForOutput,
	type ArtifactWrite,
	type ObserveFormat,
} from "../observe-output";
import { writeScreenshotFile } from "../screenshots";

/**
 * `watch` and `wait` are the timed half of observation. They share this
 * module because both block for a bounded time and then print a tree.
 */
export type WaitCommandDependencies = {
	client: (url?: string, timeoutMs?: number) => ApplicationCommandClient;
	json: (value: unknown) => void;
	write?: (text: string) => void;
};

export const DEFAULT_WATCH_FRAMES = 4;
/** Leave the server time to answer after its own deadline passes. */
const CLIENT_GRACE_MS = 15_000;

export type WatchFlags = {
	device: string;
	url?: string;
	watch: number;
	samples?: number;
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
export const watchFramesOption = boundedInteger(
	"Frame count",
	1,
	WATCH_MAX_FRAMES,
);

function output(dependencies: WaitCommandDependencies, text: string): void {
	const write =
		dependencies.write ?? ((value: string) => process.stdout.write(value));
	write(`${text}\n`);
}

function writeSheet(watch: DeviceWatch, out?: string): ArtifactWrite | null {
	if (!watch.sheet) return null;
	try {
		return {
			status: "ok",
			path: writeScreenshotFile({
				kind: "observe",
				device: watch.device,
				content: watch.sheet.bytes,
				mimeType: watch.sheet.mimeType,
				outputPath: out,
			}),
		};
	} catch (error) {
		return {
			status: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** `observe --watch` delegates here so the timed path stays in one module. */
export async function runObserveWatch(
	dependencies: WaitCommandDependencies,
	flags: WatchFlags,
): Promise<void> {
	const durationMs = flags.watch;
	const frames = flags.samples ?? DEFAULT_WATCH_FRAMES;
	const result = (await dependencies
		.client(flags.url, durationMs + CLIENT_GRACE_MS)
		.watchDevice(flags.device, { durationMs, frames })) as DeviceWatch;
	const artifact = writeSheet(result, flags.out);
	if (artifact?.status === "error" || result.frames.length === 0)
		process.exitCode = 1;
	if (flags.json) return dependencies.json(watchForOutput(result, artifact));
	output(dependencies, renderWatch(result, artifact, flags));
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
