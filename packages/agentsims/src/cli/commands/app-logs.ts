import { InvalidArgumentError, type Command } from "commander";
import type { LogTarget } from "../../core/tools/logs/contracts";
import { parseLogQuery } from "../../core/tools/logs/query";
import { parseLogTarget } from "../../core/tools/logs/target";
import { renderAppLogEvent, renderAppLogs } from "../device-logs-output";
import {
	clientOf,
	deviceCommand,
	integerOption,
	printJson,
	writerOf,
	type CommandDependencies,
	type DeviceFlags,
} from "./shared";

export type AppLogCommandDependencies = CommandDependencies & {
	/** The CLI entry point owns signal handlers. */
	follow?: (run: (signal: AbortSignal) => Promise<void>) => Promise<void>;
};
type Flags = DeviceFlags & {
	json?: boolean;
	follow?: boolean;
	limit: number;
	cursor?: string;
	level?: string;
	query?: string;
	source?: string;
	app?: string;
	pid?: number;
	process?: string;
	projectId?: string;
	metroUrl?: string;
	inspectorTarget?: string;
};

export function registerAppLogCommands(
	program: Command,
	dependencies: AppLogCommandDependencies = {},
): Command {
	const client = clientOf(dependencies);
	const write = writerOf(dependencies);
	deviceCommand(
		program,
		"app-logs",
		"Read application logs from iOS or Android",
	)
		.option(
			"--json",
			"Print structured output; follow prints one JSON event per line",
		)
		.option("--follow", "Follow live application logs until canceled")
		.option(
			"--limit <count>",
			"Maximum records in a snapshot or stream batch",
			integerOption("Log limit", 1, 2000),
			100,
		)
		.option("--cursor <cursor>", "Continue after this device cursor")
		.option(
			"--level <level>",
			"Minimum level: trace, debug, info, warn, error, or fatal",
		)
		.option("--query <text>", "Keep records that contain this text")
		.option(
			"--source <sources>",
			"Comma-separated sources: ios-native, android-native, react-native",
		)
		.option(
			"--app <id>",
			"Follow this application instead of the foreground application",
		)
		.option(
			"--pid <pid>",
			"Follow this application's native process",
			integerOption("PID", 1, 2_147_483_647),
		)
		.option(
			"--process <name>",
			"Keep records with this exact native process name",
		)
		.option(
			"--project-id <id>",
			"Explicit server source project key for React Native logs",
		)
		.option("--metro-url <url>", "Local Metro origin for React Native logs")
		.option(
			"--inspector-target <id>",
			"Explicit Metro inspector target for React Native logs",
		)
		.action(async (flags: Flags) => {
			if (flags.pid !== undefined && flags.app === undefined)
				throw new InvalidArgumentError("--pid requires --app.");
			const hasInspector =
				flags.projectId !== undefined ||
				flags.metroUrl !== undefined ||
				flags.inspectorTarget !== undefined;
			if (
				hasInspector &&
				(!flags.projectId || !flags.metroUrl || !flags.inspectorTarget)
			)
				throw new InvalidArgumentError(
					"React Native logs require --project-id, --metro-url, and --inspector-target together.",
				);
			const target: LogTarget = parseLogTarget({
				device: flags.device,
				app:
					flags.app === undefined
						? { mode: "foreground" }
						: { mode: "fixed", id: flags.app, pid: flags.pid },
				reactNative: hasInspector
					? {
							projectId: flags.projectId,
							metroUrl: flags.metroUrl,
							targetId: flags.inspectorTarget,
						}
					: undefined,
			});
			const query = parseLogQuery({
				device: flags.device,
				cursor: flags.cursor,
				limit: flags.limit,
				level: flags.level,
				query: flags.query,
				source: flags.source,
				app: flags.app,
				pid: flags.pid,
				process: flags.process,
			});
			if (!flags.follow) {
				const result = await client(flags.url).appLogs(target, query);
				if (flags.json) return printJson(write, result);
				write(`${renderAppLogs(result)}\n`);
				return;
			}
			const run = async (signal: AbortSignal) => {
				for await (const event of client(flags.url).streamAppLogs(
					target,
					query,
					signal,
				)) {
					if (flags.json) write(`${JSON.stringify(event)}\n`);
					else {
						const text = renderAppLogEvent(event);
						if (text) write(`${text}\n`);
					}
				}
			};
			if (dependencies.follow) await dependencies.follow(run);
			else await run(new AbortController().signal);
		});
	return program;
}
