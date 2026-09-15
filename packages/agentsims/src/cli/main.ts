#!/usr/bin/env bun
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { configureDistDirectory, dirnameOf } from "../core/native-paths";
import {
	DEVICE_BUTTONS,
	DEVICE_ORIENTATIONS,
	GESTURE_PHASES,
	parseDeviceAction,
} from "../core/tools/input";
import { androidSerialFromStateId } from "../core/android/device/identifiers";
import { normalizeAndroidPermission } from "../core/android/permissions";
import {
	AndroidPackageSchema,
	BundleIdSchema,
	PermissionNameSchema,
} from "../core/tools/permissions";
import { ApplicationCommandClient } from "./application-command-client";
import {
	emptyDeviceMessage,
	filterDeviceRows,
	formatDeviceDetail,
	formatDeviceTable,
	type DeviceListFilter,
	type DeviceListRow,
} from "./device-list";
import {
	observationFileName,
	renderObservation,
	shotsToPrune,
	type Observation,
} from "./observe-output";
import {
	renderAppList,
	renderPermissionList,
	renderServerStatus,
	renderWebcamList,
} from "./render";
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
function writeObservationScreenshot(
	observation: Observation,
	device: string,
	out?: string,
): string | null {
	const base64 = observation.screenshot?.contentBase64;
	if (!base64) return null;
	if (out) {
		mkdirSync(dirname(out), { recursive: true });
		writeFileSync(out, Buffer.from(base64, "base64"));
		return out;
	}
	const directory = join(tmpdir(), "agentsims", "screenshots");
	mkdirSync(directory, { recursive: true });
	const target = join(
		directory,
		observationFileName(device, observation.screenshot?.mimeType, new Date()),
	);
	writeFileSync(target, Buffer.from(base64, "base64"));
	pruneScreenshots(directory);
	return target;
}

/** Never let an agent loop fill the disk with screenshots it already read. */
function pruneScreenshots(directory: string): void {
	try {
		const shots = readdirSync(directory)
			.filter((name) => name.startsWith("observe-"))
			.map((name) => ({
				name,
				modifiedMs: statSync(join(directory, name)).mtimeMs,
			}));
		for (const name of shotsToPrune(shots, Date.now()))
			rmSync(join(directory, name), { force: true });
	} catch {
		// Pruning is best effort; never fail an observe over housekeeping.
	}
}
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
const integer =
	(name: string, minimum: number, maximum: number) =>
	(value: string): number => {
		const parsed = Number(value);
		if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
			throw new InvalidArgumentError(
				`${name} must be an integer between ${minimum} and ${maximum}.`,
			);
		return parsed;
	};
const logLevel = (value: string) => {
	const parsed = value.toUpperCase();
	if (!/^[VDIWEF]$/.test(parsed))
		throw new InvalidArgumentError("Log level must be V, D, I, W, E, or F.");
	return parsed;
};
const coordinate =
	(name: string) =>
	(value: string): number => {
		const parsed = Number(value);
		if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1)
			throw new InvalidArgumentError(
				`${name} must be a number between 0 and 1.`,
			);
		return parsed;
	};
const oneOf =
	<T extends string>(name: string, values: readonly T[]) =>
	(value: string): T => {
		if ((values as readonly string[]).includes(value)) return value as T;
		throw new InvalidArgumentError(`${name} must be one of: ${values.join(", ")}.`);
	};
const cameraFace = (value: string): "front" | "back" => {
	if (value === "front" || value === "back") return value;
	throw new InvalidArgumentError("Camera face must be front or back.");
};
type DeviceFlags = { device: string; url?: string };
type PermissionFlags = DeviceFlags & { app: string };
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
		.option("--json", "Print the raw payload")
		.action((flags: { json?: boolean }) => {
			const status = readLocalServer() ?? { running: false };
			if (flags.json) return json(status);
			process.stdout.write(`${renderServerStatus(status)}\n`);
		});
	program
		.command("logs")
		.description("Print the output of the detached Agentsims server")
		.option("-f, --follow", "Follow server output")
		.action(async (flags: { follow?: boolean }) => {
			if (!existsSync(localServerLogFile)) return;
			if (!flags.follow) {
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
	program
		.command("device-logs")
		.alias("logcat")
		.description("Read a recent log snapshot from an Android device")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option(
			"--limit <count>",
			"Maximum log lines",
			integer("Log limit", 1, 2000),
			100,
		)
		.option("--level <level>", "Minimum log level: V, D, I, W, E, or F", logLevel)
		.option("--query <text>", "Keep lines that contain this text")
		.option("--app <package>", "Keep lines from this app package")
		.option(
			"--pid <pid>",
			"Keep lines from this process ID",
			integer("PID", 1, 2_147_483_647),
		)
		.action(
			async (
				flags: DeviceFlags & {
					limit: number;
					level?: string;
					query?: string;
					app?: string;
					pid?: number;
				},
			) =>
				json(
					await client(flags.url).deviceLogs(flags.device, {
						limit: flags.limit,
						level: flags.level,
						query: flags.query,
						package: flags.app,
						pid: flags.pid,
					}),
				),
		);
	const devices = program
		.command("devices")
		.description("List, boot, or shut down devices");
	devices
		.command("list", { isDefault: true })
		.description("List devices (active ones by default)")
		.option("--url <url>")
		.option("-a, --all", "Include inactive devices")
		.option("--inactive", "Show only inactive devices")
		.option("--json", "Print the raw payload instead of a table")
		.action(
			async (flags: {
				url?: string;
				all?: boolean;
				inactive?: boolean;
				json?: boolean;
			}) => {
				const payload = await client(flags.url).listDevices();
				if (flags.json) return json(payload);
				const rows = (payload as { devices?: DeviceListRow[] }).devices ?? [];
				const filter: DeviceListFilter = flags.inactive
					? "inactive"
					: flags.all
						? "all"
						: "active";
				const selected = filterDeviceRows(rows, filter);
				process.stdout.write(
					`${formatDeviceTable(selected, emptyDeviceMessage(filter, rows.length))}\n`,
				);
			},
		);
	devices
		.command("show <device>")
		.description("Show one device")
		.option("--url <url>")
		.option("--json", "Print the raw payload")
		.action(async (device: string, flags: { url?: string; json?: boolean }) => {
			const payload = await client(flags.url).listDevices();
			const rows = (payload as { devices?: DeviceListRow[] }).devices ?? [];
			const match = rows.find((row) => row.device === device);
			if (!match)
				throw new Error(
					`device ${device} not found. Run \`agentsims devices --all\` to list device IDs.`,
				);
			if (flags.json) return json(match);
			process.stdout.write(`${formatDeviceDetail(match)}\n`);
		});
	devices
		.command("boot <device>")
		.description("Boot a simulator or emulator")
		.option("--url <url>")
		.action(async (device: string, flags: { url?: string }) =>
			json(await client(flags.url).startDevice(device)),
		);
	devices
		.command("shutdown <device>")
		.description("Shut down a simulator or emulator")
		.option("--url <url>")
		.action(async (device: string, flags: { url?: string }) =>
			json(await client(flags.url).shutdownDevice(device)),
		);
	const deviceCommand = (name: string, description: string) =>
		program
			.command(name)
			.description(description)
			.requiredOption("-d, --device <id>")
			.option("--url <url>");
	const send = (flags: { device: string; url?: string }, action: unknown) =>
		client(flags.url).actDevice(flags.device, [action]);

	deviceCommand("tap <x> <y>", "Tap a point, in screen fractions from 0 to 1")
		.action(async (x: string, y: string, flags: DeviceFlags) =>
			json(
				await send(flags, {
					type: "tap",
					x: coordinate("x")(x),
					y: coordinate("y")(y),
				}),
			),
		);
	deviceCommand(
		"swipe <x1> <y1> <x2> <y2>",
		"Swipe between two points, in screen fractions from 0 to 1",
	)
		.option(
			"--duration <ms>",
			"Swipe duration in milliseconds",
			integer("Duration", 1, 5_000),
		)
		.action(
			async (
				x1: string,
				y1: string,
				x2: string,
				y2: string,
				flags: DeviceFlags & { duration?: number },
			) =>
				json(
					await send(flags, {
						type: "swipe",
						x1: coordinate("x1")(x1),
						y1: coordinate("y1")(y1),
						x2: coordinate("x2")(x2),
						y2: coordinate("y2")(y2),
						...(flags.duration === undefined
							? {}
							: { durationMs: flags.duration }),
					}),
				),
		);
	deviceCommand("text <text>", "Type text into the focused field").action(
		async (text: string, flags: DeviceFlags) =>
			json(await send(flags, { type: "type", text })),
	);
	deviceCommand(
		"button <name>",
		`Press a hardware button: ${DEVICE_BUTTONS.join(", ")}`,
	).action(async (name: string, flags: DeviceFlags) =>
		json(
			await send(flags, {
				type: "button",
				button: oneOf("Button", DEVICE_BUTTONS)(name),
			}),
		),
	);
	deviceCommand(
		"rotate <orientation>",
		`Rotate the device: ${DEVICE_ORIENTATIONS.join(", ")}`,
	).action(async (orientation: string, flags: DeviceFlags) =>
		json(
			await send(flags, {
				type: "rotate",
				orientation: oneOf("Orientation", DEVICE_ORIENTATIONS)(orientation),
			}),
		),
	);
	deviceCommand(
		"gesture <phase> <x> <y>",
		`One phase of a held touch: ${GESTURE_PHASES.join(", ")}`,
	).action(async (phase: string, x: string, y: string, flags: DeviceFlags) =>
		json(
			await send(flags, {
				type: "gesture",
				phase: oneOf("Phase", GESTURE_PHASES)(phase),
				x: coordinate("x")(x),
				y: coordinate("y")(y),
			}),
		),
	);

	program
		.command("observe")
		.description("Capture a screenshot and the accessibility tree")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--no-ax")
		.option("-o, --out <path>", "Where to write the screenshot")
		.option("--json", "Print the raw payload, screenshot inline as base64")
		.action(
			async (flags: {
				device: string;
				url?: string;
				ax: boolean;
				out?: string;
				json?: boolean;
			}) => {
				const result = (await client(flags.url).observeDevice(
					flags.device,
					flags.ax,
				)) as Observation;
				if (flags.json) return json(result);
				const path = writeObservationScreenshot(result, flags.device, flags.out);
				process.stdout.write(`${renderObservation(result, path)}\n`);
			},
		);
	program
		.command("act <json>", { hidden: true })
		.description("Send one input action as JSON. Prefer tap, swipe, and text.")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.action(async (input: string, flags: { device: string; url?: string }) =>
			json(
				await client(flags.url).actDevice(flags.device, [
					parseDeviceAction(input),
				]),
			),
		);
	const camera = program
		.command("camera")
		.description("Use a host webcam as the device camera");
	camera
		.command("list", { isDefault: true })
		.alias("webcams")
		.description("List the host webcams available to a device")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--json", "Print the raw payload")
		.action(async (flags: DeviceFlags & { json?: boolean }) => {
			const payload = await client(flags.url).listWebcams(flags.device);
			if (flags.json) return json(payload);
			process.stdout.write(`${renderWebcamList(payload)}\n`);
		});
	camera
		.command("use <webcam-id>")
		.alias("webcam")
		.description("Send a host webcam to the device camera")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option(
			"--face <face>",
			"Android camera to replace: front or back",
			cameraFace,
		)
		.action(
			async (
				webcam: string,
				flags: DeviceFlags & { face?: "front" | "back" },
			) => {
				const android = flags.device.startsWith("android:");
				if (android && !flags.face)
					throw new Error("Android webcam selection requires --face.");
				if (!android && flags.face)
					throw new Error("--face is available only for Android emulators.");
				json(
					await client(flags.url).selectWebcam(
						flags.device,
						webcam,
						flags.face,
					),
				);
			},
		);
	camera
		.command("stop")
		.description("Stop webcam input for a device")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.action(async (flags: DeviceFlags) =>
			json(await client(flags.url).stopCamera(flags.device)),
		);
	const app = program.command("app").description("Manage apps on a device");
	const appCommand = (name: string, description: string) =>
		app
			.command(name)
			.description(description)
			.requiredOption("-d, --device <id>")
			.option("--url <url>");
	const runApp = (flags: DeviceFlags, operation: string, value?: string) =>
		client(flags.url).app(flags.device, operation, value);

	appCommand("list", "List the apps installed on a device")
		.option("-a, --all", "Include system apps")
		.option("--json", "Print the raw payload")
		.action(async (flags: DeviceFlags & { all?: boolean; json?: boolean }) => {
			const payload = await runApp(flags, "list");
			if (flags.json) return json(payload);
			process.stdout.write(`${renderAppList(payload, flags.all === true)}\n`);
		});
	appCommand("install <path>", "Install an .app or .apk build").action(
		async (path: string, flags: DeviceFlags) =>
			json(await runApp(flags, "install", path)),
	);
	appCommand("launch <app-id>", "Launch an installed app").action(
		async (appId: string, flags: DeviceFlags) =>
			json(await runApp(flags, "launch", appId)),
	);
	appCommand("stop <app-id>", "Stop a running app").action(
		async (appId: string, flags: DeviceFlags) =>
			json(await runApp(flags, "stop", appId)),
	);
	appCommand("uninstall <app-id>", "Remove an installed app").action(
		async (appId: string, flags: DeviceFlags) =>
			json(await runApp(flags, "uninstall", appId)),
	);
	const permissions = program
		.command("permissions")
		.description("List, grant, revoke, or reset app permissions");
	const permissionCommand = (name: string, description: string) =>
		permissions
			.command(name)
			.description(description)
			.requiredOption("-d, --device <id>")
			.requiredOption("-a, --app <app-id>", "Bundle ID or Android package name")
			.option("--url <url>");

	// iOS names a privacy service. Android names a runtime permission.
	const appId = (flags: PermissionFlags): string => {
		const android = Boolean(androidSerialFromStateId(flags.device));
		const parsed = (
			android ? AndroidPackageSchema : BundleIdSchema
		).safeParse(flags.app);
		if (!parsed.success)
			throw new Error(
				android
					? "App must be a valid Android package name."
					: "App must be a valid bundle identifier.",
			);
		return parsed.data;
	};
	const permissionName = (flags: PermissionFlags, name: string): string => {
		const resolved = androidSerialFromStateId(flags.device)
			? normalizeAndroidPermission(name)
			: (PermissionNameSchema.safeParse(name).data ?? null);
		if (!resolved) throw new Error("Unknown permission name.");
		return resolved;
	};

	permissionCommand("list", "Show the permission state of an app")
		.option("--json", "Print the raw payload")
		.action(async (flags: PermissionFlags & { json?: boolean }) => {
			const payload = await client(flags.url).listPermissions(
				flags.device,
				appId(flags),
			);
			if (flags.json) return json(payload);
			process.stdout.write(`${renderPermissionList(payload)}\n`);
		});
	permissionCommand("grant <permission>", "Grant one permission")
		.option("--value <value>", "iOS grant value, such as always or limited")
		.action(
			async (
				permission: string,
				flags: PermissionFlags & { value?: string },
			) => {
				if (flags.value && androidSerialFromStateId(flags.device))
					throw new Error("--value is available only for iOS simulators.");
				json(
					await client(flags.url).mutatePermissions(flags.device, {
						operation: "grant",
						bundleId: appId(flags),
						permission: permissionName(flags, permission),
						...(flags.value ? { value: flags.value } : {}),
					}),
				);
			},
		);
	permissionCommand("revoke <permission>", "Revoke one permission").action(
		async (permission: string, flags: PermissionFlags) =>
			json(
				await client(flags.url).mutatePermissions(flags.device, {
					operation: "revoke",
					bundleId: appId(flags),
					permission: permissionName(flags, permission),
				}),
			),
	);
	permissionCommand(
		"reset [permission]",
		"Reset one permission, or the whole app when no name is given",
	).action(async (permission: string | undefined, flags: PermissionFlags) =>
		json(
			await client(flags.url).mutatePermissions(flags.device, {
				operation: "reset",
				bundleId: appId(flags),
				...(permission
					? { permission: permissionName(flags, permission) }
					: {}),
			}),
		),
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
