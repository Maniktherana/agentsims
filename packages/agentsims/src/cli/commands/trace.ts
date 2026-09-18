import type { Command } from "commander";
import type {
	TraceStarted,
	TraceStopped,
	TraceRun,
} from "../../core/tools/traces/traces";
import {
	clientOf,
	deviceCommand,
	printJson,
	writerOf,
	type CommandDependencies,
	type DeviceFlags,
} from "./shared";

type TraceFlags = DeviceFlags & { json?: boolean; name?: string };

/**
 * A trace writes every command the server runs for a device to disk, with a
 * screenshot of each one. Start it before the work you want to review.
 */
export function registerTraceCommands(
	program: Command,
	dependencies: CommandDependencies = {},
): Command {
	const client = clientOf(dependencies);
	const write = writerOf(dependencies);
	const trace = program
		.command("trace")
		.description("Record every command for a device to a file on disk");
	const subcommand = (name: string, description: string) =>
		deviceCommand(trace, name, description).option(
			"--json",
			"Print structured output",
		);

	subcommand("start", "Start a trace for a device")
		.option("--name <text>", "Name the trace directory")
		.addHelpText(
			"after",
			`
Traces land in ~/.agentsims/traces/<trace-id>/.

Examples:
  agentsims trace start -d <id> --name checkout
  agentsims trace stop -d <id>
`,
		)
		.action(async (flags: TraceFlags) => {
			const result = (await client(flags.url).startTrace(
				flags.device,
				flags.name,
			)) as TraceStarted;
			if (flags.json) return printJson(write, result);
			write(
				`trace  started  device=${result.device}  id=${result.id}  dir=${result.directory}\n`,
			);
		});

	subcommand("stop", "Stop the active trace for a device").action(
		async (flags: TraceFlags) => {
			const result = (await client(flags.url).stopTrace(
				flags.device,
			)) as TraceStopped;
			if (flags.json) return printJson(write, result);
			write(
				`trace  stopped  device=${result.device}  id=${result.id}  calls=${result.calls}  dir=${result.directory}\n`,
			);
		},
	);

	subcommand("status", "Print the active trace for a device").action(
		async (flags: TraceFlags) => {
			const result = (await client(flags.url).traceStatus(flags.device)) as {
				device: string;
				active: TraceRun | null;
			};
			if (flags.json) return printJson(write, result);
			if (!result.active) return write(`trace  none  device=${result.device}\n`);
			write(
				`trace  active  device=${result.device}  id=${result.active.id}  calls=${result.active.calls}  dir=${result.active.directory}\n`,
			);
		},
	);

	return program;
}
