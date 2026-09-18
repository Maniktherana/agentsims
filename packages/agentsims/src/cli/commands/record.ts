import type { Command } from "commander";
import type {
	RecordingStarted,
	RecordingStatus,
	RecordingStopped,
} from "../../core/tools/recording/recordings";
import {
	clientOf,
	deviceCommand,
	printJson,
	writerOf,
	type CommandDependencies,
	type DeviceFlags,
} from "./shared";

/**
 * `record` writes the device screen to an MP4 while the agent drives the
 * device. The bytes are the ones the device already encodes, so the command
 * starts a copy and nothing more.
 */
export type RecordFlags = DeviceFlags & { json?: boolean; out?: string };

const EXAMPLE = `
Examples:
  agentsims record start -d <id>
  agentsims record start -d <id> --out ./run.mp4
  agentsims record status -d <id>
  agentsims record stop -d <id>

A rotation splits the video: stop prints one path per segment.
`;

function seconds(durationMs: number): string {
	return (durationMs / 1000).toFixed(1);
}

function megabytes(bytes: number): string {
	return (bytes / 1_000_000).toFixed(1);
}

export function renderRecordingStarted(started: RecordingStarted): string {
	return [
		"recording",
		"started",
		`device=${started.device}`,
		`path=${started.path}`,
	].join("  ");
}

export function renderRecordingStopped(stopped: RecordingStopped): string {
	const lines = [
		[
			"recording",
			"stopped",
			`device=${stopped.device}`,
			`frames=${stopped.frames}`,
			`duration=${seconds(stopped.durationMs)}s`,
			`size=${megabytes(stopped.bytes)}MB`,
			...(stopped.ended ? [`ended=${stopped.ended}`] : []),
		].join("  "),
		...stopped.paths.map((path) => `path=${path}`),
	];
	if (stopped.paths.length === 0) lines.push("path=none");
	if (stopped.error) lines.push(`error  ${stopped.error}`);
	return lines.join("\n");
}

export function renderRecordingStatus(status: RecordingStatus): string {
	const recording = status.recording;
	if (!recording) return `recording  none  device=${status.device}`;
	return [
		"recording",
		"active",
		`device=${status.device}`,
		`path=${recording.path}`,
		`frames=${recording.frames}`,
		`since=${recording.startedAt}`,
		...(recording.ended ? [`ended=${recording.ended}`] : []),
	].join("  ");
}

export function registerRecordCommands(
	program: Command,
	dependencies: CommandDependencies = {},
): Command {
	const client = clientOf(dependencies);
	const write = writerOf(dependencies);
	const record = program
		.command("record")
		.description("Record the device screen to an MP4")
		.addHelpText("after", EXAMPLE);
	deviceCommand(record, "start", "Start recording the device screen")
		.option("--out <path>", "Write to this file or directory")
		.option("--json", "Print structured output")
		.action(async (flags: RecordFlags) => {
			const started = (await client(flags.url).startRecording(
				flags.device,
				flags.out === undefined ? {} : { out: flags.out },
			)) as RecordingStarted;
			if (flags.json) return printJson(write, started);
			write(`${renderRecordingStarted(started)}\n`);
		});
	deviceCommand(record, "stop", "Finish the recording and print its path")
		.option("--json", "Print structured output")
		.action(async (flags: RecordFlags) => {
			const stopped = (await client(flags.url).stopRecording(
				flags.device,
			)) as RecordingStopped;
			if (stopped.frames === 0 || stopped.error) process.exitCode = 1;
			if (flags.json) return printJson(write, stopped);
			write(`${renderRecordingStopped(stopped)}\n`);
		});
	deviceCommand(record, "status", "Report whether a recording is running")
		.option("--json", "Print structured output")
		.action(async (flags: RecordFlags) => {
			const status = (await client(flags.url).recordingStatus(
				flags.device,
			)) as RecordingStatus;
			if (flags.json) return printJson(write, status);
			write(`${renderRecordingStatus(status)}\n`);
		});
	return program;
}
