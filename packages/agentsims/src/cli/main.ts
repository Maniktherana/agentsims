#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { configureDistDirectory, dirnameOf } from "../core/native-paths";
import { parseDeviceAction } from "../core/tools/input";
import { ApplicationCommandClient } from "./application-command-client";
import {
	formatHostDiagnostics,
	hostDiagnosticsFor,
	type DoctorPlatform,
} from "./doctor";
import {
	localServerLogFile,
	readLocalServer,
	runLocalServer,
	startDetached,
	stopLocalServer,
	type LocalServerOptions,
} from "./local-server";

declare const __AGENTSIMS_STANDALONE__: boolean;
declare const __AGENTSIMS_VERSION__: string | undefined;
if (typeof __AGENTSIMS_STANDALONE__ !== "undefined" && __AGENTSIMS_STANDALONE__)
	configureDistDirectory(dirname(process.execPath));

function version(): string {
	if (typeof __AGENTSIMS_VERSION__ === "string") return __AGENTSIMS_VERSION__;
	for (const path of [
		join(dirnameOf(import.meta.url), "../package.json"),
		join(dirnameOf(import.meta.url), "../../package.json"),
	]) {
		if (existsSync(path))
			return JSON.parse(readFileSync(path, "utf8")).version ?? "0.0.0";
	}
	return "0.0.0";
}
const json = (value: unknown): void => {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};
const client = (url?: string) =>
	new ApplicationCommandClient({ origin: url ?? readLocalServer()?.url });
const port = (value: string) => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535)
		throw new InvalidArgumentError(
			"Port must be an integer between 0 and 65535.",
		);
	return parsed;
};
const codec = (value: string): LocalServerOptions["codec"] => {
	if (value === "auto" || value === "h264" || value === "mjpeg") return value;
	throw new InvalidArgumentError("Codec must be auto, h264, or mjpeg.");
};
type ServerFlags = {
	host: string;
	port: number;
	basePath: string;
	codec: LocalServerOptions["codec"];
	json?: boolean;
	managed?: boolean;
	detach?: boolean;
};
const serverOptions = (flags: ServerFlags): LocalServerOptions => flags;
function addServerFlags(command: Command): Command {
	return command
		.option(
			"--host <address>",
			"Server address",
			process.env.HOST || "127.0.0.1",
		)
		.option(
			"-p, --port <port>",
			"Server port",
			port,
			process.env.PORT ? port(process.env.PORT) : 3200,
		)
		.option("--base-path <path>", "Preview URL path", "/")
		.option("--codec <codec>", "Video codec", codec, "auto");
}

export function createProgram(): Command {
	const program = new Command()
		.name("agentsims")
		.description("Run a local iOS and Android device workspace")
		.version(version());
	addServerFlags(
		program
			.command("start", { isDefault: true })
			.description("Start the local server"),
	)
		.option("--detach", "Run the server in the background")
		.option("--json", "Print readiness as JSON")
		.action(async (flags: ServerFlags) => {
			if (flags.detach) json(await startDetached(serverOptions(flags)));
			else await runLocalServer(serverOptions(flags));
		});
	addServerFlags(program.command("serve", { hidden: true }))
		.option("--json")
		.option("--managed")
		.action((flags: ServerFlags) => runLocalServer(serverOptions(flags)));
	program
		.command("stop")
		.description("Stop the locally owned detached server")
		.action(async () => {
			process.stdout.write(
				(await stopLocalServer())
					? "Agentsims stopped.\n"
					: "Agentsims is not running.\n",
			);
		});
	program
		.command("status")
		.description("Show local server status")
		.action(() => json(readLocalServer() ?? { running: false }));
	program
		.command("logs")
		.option("-f, --follow", "Follow server output")
		.action(async ({ follow }: { follow?: boolean }) => {
			if (!existsSync(localServerLogFile)) return;
			if (!follow) {
				process.stdout.write(readFileSync(localServerLogFile, "utf8"));
				return;
			}
			const child = Bun.spawn(["tail", "-f", localServerLogFile], {
				stdout: "inherit",
				stderr: "inherit",
			});
			const stop = () => child.kill();
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
			try {
				await child.exited;
			} finally {
				process.off("SIGINT", stop);
				process.off("SIGTERM", stop);
			}
		});
	const devices = program
		.command("devices [operation]")
		.description("List, boot, or shut down devices")
		.argument("[device]")
		.option("--url <url>")
		.action(
			async (
				operation = "list",
				device: string | undefined,
				flags: { url?: string },
			) => {
				const api = client(flags.url);
				if (operation === "list") {
					json(await api.listDevices());
					return;
				}
				if (!device) throw new Error("Device is required.");
				if (operation === "boot") {
					json(await api.startDevice(device));
					return;
				}
				if (operation === "shutdown") {
					json(await api.shutdownDevice(device));
					return;
				}
				throw new Error("Operation must be list, boot, or shutdown.");
			},
		);
	void devices;
	program
		.command("observe")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--no-ax")
		.action(async (flags: { device: string; url?: string; ax: boolean }) =>
			json(await client(flags.url).observeDevice(flags.device, flags.ax)),
		);
	program
		.command("act <json>")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.action(async (input: string, flags: { device: string; url?: string }) =>
			json(
				await client(flags.url).actDevice(flags.device, [
					parseDeviceAction(input),
				]),
			),
		);
	program
		.command("app <operation> [value]")
		.description("Run a bounded app operation")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.action(
			async (
				operation: string,
				value: string | undefined,
				flags: { device: string; url?: string },
			) => {
				if (
					!["list", "launch", "stop", "install", "uninstall"].includes(
						operation,
					)
				)
					throw new Error(
						"Operation must be list, launch, stop, install, or uninstall.",
					);
				if (operation !== "list" && !value)
					throw new Error(`${operation} requires an app id or path.`);
				json(await client(flags.url).app(flags.device, operation, value));
			},
		);
	program
		.command("doctor")
		.option("--platform <platform>", "android or ios")
		.option("--json")
		.action(
			async ({
				platform,
				json: asJson,
			}: {
				platform?: DoctorPlatform;
				json?: boolean;
			}) => {
				if (platform && platform !== "android" && platform !== "ios")
					throw new Error("Platform must be android or ios.");
				const report = await Effect.runPromise(
					hostDiagnosticsFor(process.platform, platform).pipe(
						Effect.provide(BunContext.layer),
					),
				);
				if (asJson) json(report);
				else process.stdout.write(`${formatHostDiagnostics(report)}\n`);
				if (!report.ok) process.exitCode = 1;
			},
		);
	return program;
}

export async function main(argv: string[] = process.argv): Promise<void> {
	await createProgram().parseAsync(argv);
}
if (import.meta.main)
	try {
		await main();
	} catch (error) {
		process.stderr.write(
			`agentsims: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	}
