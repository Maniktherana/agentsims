import { InvalidArgumentError, Option, type Command } from "commander";
import type { ActionOptions, ActionResult } from "../../core/tools/actions";
import type { ImageCaptureChannel } from "../../core/tools/observe/observe";
import { ApplicationCommandClient } from "../application-command-client";
import { readLocalServer } from "../local-server";
import {
	actionForOutput,
	renderActionResult,
	type ArtifactWrite,
	type ObserveFormat,
	type WatchArtifacts,
} from "../observe-output";
import { writeScreenshotFile } from "../screenshots";
import {
	watchArtifactsFailed,
	watchDurationOption,
	watchEveryOption,
	watchSamplesOption,
	writeWatchArtifacts,
} from "./wait";

/**
 * Registration helpers shared by the command files. They mirror the small
 * parsers `main.ts` keeps for its own commands, so a command file stays one
 * registration line in `main.ts`.
 */
export type CommandDependencies = {
	client?: (url?: string, options?: { timeoutMs?: number }) => ApplicationCommandClient;
	write?: (text: string) => void;
};

export type DeviceFlags = { device: string; url?: string };
export type WatchFlags = {
	watch?: number;
	samples?: number;
	every?: number;
	keepFrames?: boolean;
};
export type ActionFlags = DeviceFlags &
	WatchFlags & {
		json?: boolean;
		screenshot?: boolean;
	};

/** Leave the server time to answer after the sampling window closes. */
const WATCH_GRACE_MS = 15_000;

/**
 * Watch the screen from the moment the input lands. A separate observe starts
 * too late for content that begins on the action.
 */
export function watchOptions(command: Command): Command {
	return command
		.option(
			"--watch <ms>",
			"Sample the screen from dispatch for this long",
			watchDurationOption,
		)
		.option(
			"--samples <n>",
			"How many frames --watch samples",
			watchSamplesOption,
		)
		.addOption(
			new Option("--every <ms>", "Sample a frame this often instead")
				.argParser(watchEveryOption)
				.conflicts("samples"),
		)
		.option("--keep-frames", "Also write every sampled frame");
}

/** The sampling the action asks for. The other flags need a window to fill. */
export function watchRequest(flags: WatchFlags): ActionOptions["watch"] {
	if (flags.watch === undefined) {
		const named = [
			flags.samples === undefined ? null : "--samples",
			flags.every === undefined ? null : "--every",
			flags.keepFrames ? "--keep-frames" : null,
		].filter((name): name is string => name !== null);
		if (named.length > 0)
			throw new InvalidArgumentError(`${named.join(", ")} needs --watch <ms>.`);
		return undefined;
	}
	return {
		durationMs: flags.watch,
		...(flags.samples === undefined ? {} : { samples: flags.samples }),
		...(flags.every === undefined ? {} : { everyMs: flags.every }),
		...(flags.keepFrames ? { keepFrames: true } : {}),
	};
}

/** A watched action holds the connection open for the whole window. */
export function watchTimeout(flags: WatchFlags): number | undefined {
	return flags.watch === undefined ? undefined : flags.watch + WATCH_GRACE_MS;
}

/** The sheets and kept frames of an action that watched its own effect. */
export function writeActionWatch(
	result: ActionResult,
	device: string,
): WatchArtifacts | null {
	return result.watch
		? writeWatchArtifacts(device, result.watch, { kind: "action" })
		: null;
}

export function commandClient(
	url?: string,
	options: { timeoutMs?: number } = {},
): ApplicationCommandClient {
	return new ApplicationCommandClient({
		origin: url ?? readLocalServer()?.url,
		...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
	});
}

export function clientOf(
	dependencies: CommandDependencies,
): NonNullable<CommandDependencies["client"]> {
	return dependencies.client ?? commandClient;
}

export function writerOf(
	dependencies: CommandDependencies,
): (text: string) => void {
	return (
		dependencies.write ??
		((text: string) => {
			process.stdout.write(text);
		})
	);
}

export function printJson(write: (text: string) => void, value: unknown): void {
	write(`${JSON.stringify(value, null, 2)}\n`);
}

export const integerOption =
	(name: string, minimum: number, maximum: number) =>
	(value: string): number => {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
			throw new InvalidArgumentError(
				`${name} must be an integer between ${minimum} and ${maximum}.`,
			);
		return parsed;
	};

export const positiveIntegerOption =
	(name: string) =>
	(value: string): number => {
		const parsed = Number(value);
		if (!Number.isSafeInteger(parsed) || parsed < 1)
			throw new InvalidArgumentError(`${name} must be a positive integer.`);
		return parsed;
	};

export const oneOfOption =
	<T extends string>(name: string, values: readonly T[]) =>
	(value: string): T => {
		if ((values as readonly string[]).includes(value)) return value as T;
		throw new InvalidArgumentError(
			`${name} must be one of: ${values.join(", ")}.`,
		);
	};

export function deviceCommand(
	program: Command,
	name: string,
	description: string,
): Command {
	return program
		.command(name)
		.description(description)
		.requiredOption("-d, --device <id>")
		.option("--url <url>");
}

export function writeActionImage(
	image: ImageCaptureChannel | null,
	device: string,
): ArtifactWrite | null {
	if (!image || image.status === "error") return null;
	try {
		return {
			status: "ok",
			path: writeScreenshotFile({
				kind: "action",
				device,
				content: image.value.bytes,
				mimeType: image.value.mimeType,
			}),
		};
	} catch (error) {
		return {
			status: "error",
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

/** A refused dispatch, a mismatch, or a lost image is a failed command. */
export function actionExitCode(
	result: ActionResult,
	artifact: ArtifactWrite | null,
	watch: WatchArtifacts | null = null,
): void {
	if (
		result.dispatch.status !== "accepted" ||
		result.verification.status === "mismatch" ||
		result.text?.submit.status === "suppressed" ||
		artifact?.status === "error" ||
		(watch !== null && watchArtifactsFailed(watch))
	)
		process.exitCode = 1;
}

export function printActionResult(
	dependencies: CommandDependencies,
	flags: ActionFlags,
	result: ActionResult,
	format: ObserveFormat = {},
): void {
	const write = writerOf(dependencies);
	const artifact = writeActionImage(result.image, flags.device);
	const watch = writeActionWatch(result, flags.device);
	actionExitCode(result, artifact, watch);
	if (flags.json)
		return printJson(write, actionForOutput(result, artifact, watch));
	write(`${renderActionResult(result, artifact, format, watch)}\n`);
}
