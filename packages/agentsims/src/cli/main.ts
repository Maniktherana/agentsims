#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command, InvalidArgumentError, Option } from "commander";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { configureDistDirectory, dirnameOf } from "../core/native-paths";
import {
	ANDROID_DEVICE_BUTTONS,
	DEFAULT_LONG_PRESS_DURATION_MS,
	DEVICE_ORIENTATIONS,
	IOS_DEVICE_BUTTONS,
	validateDeviceButton,
} from "../core/tools/input";
import { AX_ROLES } from "../core/tools/observe/ax-view";
import { androidSerialFromStateId } from "../core/android/device/identifiers";
import { normalizeAndroidPermission } from "../core/android/permissions";
import { permissionValueError } from "../core/ios/permissions";
import {
	AndroidPackageSchema,
	BundleIdSchema,
	PermissionNameSchema,
} from "../core/tools/permissions";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "./application-command-client";
import {
	emptyDeviceMessage,
	filterDeviceRows,
	formatDeviceDetail,
	formatDeviceTable,
	type DeviceListFilter,
	type DeviceListRow,
} from "./device-list";
import type { ActionResult } from "../core/tools/actions";
import type {
	DeviceObservation,
	DeviceScreenshot,
	ImageCaptureChannel,
} from "../core/tools/observe/observe";
import {
	actionForOutput,
	observationForOutput,
	renderActionResult,
	renderMatches,
	renderObservation,
	renderScreenshot,
	screenshotForOutput,
	type ArtifactWrite,
	type DeviceMatches,
	type ObserveFormat,
} from "./observe-output";
import { registerScrollCommands } from "./commands/scroll";
import { writeScreenshotFile } from "./screenshots";
import {
	registerWaitCommands,
	runObserveWatch,
	watchDurationOption,
	watchEveryOption,
	watchSamplesOption,
} from "./commands/wait";
import {
	renderAppList,
	renderPermissionList,
	renderServerStatus,
	renderWebcamList,
} from "./render";
import { renderDeviceLogs } from "./device-logs-output";
import { registerRunCommands } from "./commands/run";
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
function writeCapturedImage(
	image: ImageCaptureChannel | null,
	kind: "observe" | "screenshot" | "action",
	device: string,
	out?: string,
): ArtifactWrite | null {
	if (!image || image.status === "error") return null;
	try {
		return {
			status: "ok",
			path: writeScreenshotFile({
				kind,
				device,
				content: image.value.bytes,
				mimeType: image.value.mimeType,
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
const client = (url?: string, timeoutMs?: number) =>
	new ApplicationCommandClient({
		origin: url ?? readLocalServer()?.url,
		...(timeoutMs === undefined ? {} : { timeoutMs }),
	});
/** Commands in their own module receive the shared CLI seams, not globals. */
const commandDependencies = { client, json };
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
const positiveInteger = (name: string) => (value: string): number => {
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new InvalidArgumentError(`${name} must be a positive integer.`);
	return parsed;
};
const logLevel = (value: string) => {
	const parsed = value.toUpperCase();
	if (!/^[VDIWEF]$/.test(parsed))
		throw new InvalidArgumentError("Log level must be V, D, I, W, E, or F.");
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
const AX_ROLE_HELP = AX_ROLES.join(", ");
const TARGET_HELP =
	'A target is a ref (@e14) or exact label ("Search"). Percent points (50%,90%) use the live screen and need no capture. Pixel points (603,1311) require --capture cN from a screenshot.';
type DeviceFlags = { device: string; url?: string };
type ActionFlags = DeviceFlags & {
	json?: boolean;
	screenshot?: boolean;
};
type TargetFlags = ActionFlags & {
	role?: string;
	index?: number;
	capture?: string;
};
type TypeFlags = TargetFlags & { into?: string; submit?: boolean };
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
		.description("Read a recent log snapshot from an Android device")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--json", "Print the raw structured payload")
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
					json?: boolean;
				},
			) => {
				if (!androidSerialFromStateId(flags.device))
					throw new Error("Device logs require an Android device.");
				const payload = await client(flags.url).deviceLogs(flags.device, {
					limit: flags.limit,
					level: flags.level,
					query: flags.query,
					package: flags.app,
					pid: flags.pid,
				});
				if (flags.json) return json(payload);
				process.stdout.write(`${renderDeviceLogs(payload)}\n`);
			},
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
	const printAction = (flags: ActionFlags, payload: ActionResult): void => {
		const artifact = writeCapturedImage(payload.image, "action", flags.device);
		if (
			payload.dispatch.status !== "accepted" ||
			payload.verification.status === "mismatch" ||
			payload.text?.submit.status === "suppressed" ||
			artifact?.status === "error"
		)
			process.exitCode = 1;
		if (flags.json) return json(actionForOutput(payload, artifact));
		process.stdout.write(`${renderActionResult(payload, artifact)}\n`);
	};
	const act = async (flags: ActionFlags, action: unknown): Promise<void> => {
		const payload = (await client(flags.url).actDevice(
			flags.device,
			[action],
			{ screenshot: flags.screenshot === true },
		)) as ActionResult;
		printAction(flags, payload);
	};
	const actionCommand = (name: string, description: string) =>
		deviceCommand(name, description)
			.option("--json", "Print structured output")
			.option("--screenshot", "Capture the screen after the action");
	const selector = (target: string, flags: TargetFlags) => ({
		target,
		...(flags.capture ? { capture: flags.capture } : {}),
		...(flags.role ? { role: flags.role } : {}),
		...(flags.index === undefined ? {} : { index: flags.index }),
	});
	const targetCommand = (name: string, description: string) =>
		actionCommand(name, description)
			.option("--capture <id>", "Capture ID for a pixel or percent point")
			.option("--role <role>", `Match only this role: ${AX_ROLE_HELP}`)
			.option(
				"--index <n>",
				"Choose one of several matches, counted from 1",
				positiveInteger("Index"),
			);

	targetCommand("tap <target>", `Tap a target. ${TARGET_HELP}`).action(
		async (target: string, flags: TargetFlags) =>
			act(flags, { type: "tap", ...selector(target, flags) }),
	);
	targetCommand(
		"long-press <target>",
		`Press and hold a target. ${TARGET_HELP}`,
	)
		.option(
			"--duration <ms>",
			`Hold duration in milliseconds (default: ${DEFAULT_LONG_PRESS_DURATION_MS})`,
			integer("Duration", 1, 5_000),
		)
		.action(
			async (
				target: string,
				flags: TargetFlags & { duration?: number },
			) =>
				act(flags, {
					type: "long-press",
					...selector(target, flags),
					...(flags.duration === undefined
						? {}
						: { durationMs: flags.duration }),
				}),
		);
	targetCommand(
		"swipe <from> <to>",
		`Move one finger from one target to another. Coordinates use x,y. ${TARGET_HELP}`,
	)
		.option(
			"--duration <ms>",
			"Swipe duration in milliseconds",
			integer("Duration", 1, 5_000),
		)
		.addHelpText(
			"after",
			`
Direction:
  Change x for a horizontal swipe. Change y for a vertical swipe.
  <from> to <to> is the finger motion. Content moves in the opposite direction.

Examples:
  Finger left:  agentsims swipe 80%,50% 20%,50% -d <id>
  Finger right: agentsims swipe 20%,50% 80%,50% -d <id>
  Finger up:    agentsims swipe 50%,80% 50%,20% -d <id>
  Finger down:  agentsims swipe 50%,20% 50%,80% -d <id>
`,
		)
		.action(
			async (
				from: string,
				to: string,
				flags: TargetFlags & { duration?: number },
			) =>
				act(flags, {
					type: "swipe",
					from,
					to,
					...(flags.capture ? { capture: flags.capture } : {}),
					...(flags.role ? { role: flags.role } : {}),
					...(flags.index === undefined ? {} : { index: flags.index }),
					...(flags.duration === undefined
						? {}
						: { durationMs: flags.duration }),
				}),
		);
	registerScrollCommands(program);
	const typeCommand = (name: string, description: string) =>
		actionCommand(name, description)
			.option("--into <target>", `Field to type into. ${TARGET_HELP}`)
			.option("--capture <id>", "Capture ID for a pixel or percent point")
			.option("--role <role>", `Match only this role: ${AX_ROLE_HELP}`)
			.option(
				"--index <n>",
				"Choose one of several matches, counted from 1",
				positiveInteger("Index"),
			)
			.option("--submit", "Press Return after the text");
	const typeText =
		(clear: boolean) =>
		async (text: string, flags: TypeFlags): Promise<void> =>
			act(flags, {
				type: "type",
				text,
				...(flags.into ? { into: flags.into } : {}),
				...(flags.capture ? { capture: flags.capture } : {}),
				...(flags.role ? { role: flags.role } : {}),
				...(flags.index === undefined ? {} : { index: flags.index }),
				...(clear ? { clear: true } : {}),
				...(flags.submit ? { submit: true } : {}),
			});
	typeCommand(
		"type <text>",
		"Type into a field, then read the field back",
	).action(typeText(false));
	typeCommand(
		"fill <text>",
		"Replace a field value, then read the field back",
	).action(typeText(true));
	actionCommand(
		"press <name>",
		`Press a hardware button. Android: ${ANDROID_DEVICE_BUTTONS.join(", ")}. iOS: ${IOS_DEVICE_BUTTONS.join(", ")}.`,
	).action(async (name: string, flags: ActionFlags) =>
		act(flags, {
			type: "button",
			button: validateDeviceButton(flags.device, name),
		}),
	);
	actionCommand(
		"rotate <orientation>",
		`Rotate the device: ${DEVICE_ORIENTATIONS.join(", ")}`,
	).action(async (orientation: string, flags: ActionFlags) =>
		act(flags, {
			type: "rotate",
			orientation: oneOf("Orientation", DEVICE_ORIENTATIONS)(orientation),
		}),
	);
	registerRunCommands(program, { client, json });
	program
		.command("observe")
		.description("Capture a screenshot and the accessibility tree")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--all", "Print every node, not only the useful ones")
		.option("--frames", "Add [box=x,y,w,h] in screenshot pixels")
		.option("--raw", "Print the platform class in place of the role")
		.option("-o, --out <path>", "Where to write the screenshot")
		.option(
			"--watch <ms>",
			"Sample the screen over this long into contact sheets",
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
		.option(
			"--region <target>",
			"Crop every frame to a ref, an exact label, or x,y,w,h",
		)
		.option("--keep-frames", "Also write every sampled frame")
		.option("--json", "Print structured output")
		.action(
			async (
				flags: DeviceFlags & {
					all?: boolean;
					out?: string;
					json?: boolean;
					watch?: number;
					samples?: number;
					every?: number;
					region?: string;
					keepFrames?: boolean;
				} & ObserveFormat,
			) => {
				if (flags.watch !== undefined)
					return runObserveWatch(commandDependencies, {
						...flags,
						watch: flags.watch,
					});
				const result = (await client(flags.url).observeDevice(flags.device, {
					all: flags.all,
				})) as DeviceObservation;
				const artifact = writeCapturedImage(
					result.image,
					"observe",
					flags.device,
					flags.out,
				);
				if (
					result.accessibility.status === "error" &&
					result.image.status === "error"
				)
					process.exitCode = 1;
				if (artifact?.status === "error") process.exitCode = 1;
				if (flags.json) return json(observationForOutput(result, artifact));
				process.stdout.write(
					`${renderObservation(result, artifact, flags)}\n`,
				);
			},
		);
	program
		.command("screenshot [path]")
		.description("Capture the device image without accessibility")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--json", "Print structured output")
		.action(
			async (
				path: string | undefined,
				flags: DeviceFlags & { json?: boolean },
			) => {
				const result = (await client(flags.url).screenshotDevice(
					flags.device,
				)) as DeviceScreenshot;
				const artifact = writeCapturedImage(
					result.image,
					"screenshot",
					flags.device,
					path,
				);
				if (
					result.image.status === "error" ||
					artifact?.status === "error"
				)
					process.exitCode = 1;
				if (flags.json) return json(screenshotForOutput(result, artifact));
				process.stdout.write(`${renderScreenshot(result, artifact)}\n`);
			},
		);
	registerWaitCommands(program, commandDependencies);
	program
		.command("find <text>")
		.description("Print the nodes that match a label, value, or test ID")
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--json", "Print structured output")
		.action(async (text: string, flags: DeviceFlags & { json?: boolean }) => {
			const matches = (await client(flags.url).findOnDevice(
				flags.device,
				text,
			)) as DeviceMatches;
			if (flags.json) return json(matches);
			process.stdout.write(`${renderMatches(matches)}\n`);
		});
	const camera = program
		.command("camera")
		.description("Use a host webcam as the device camera");
	camera
		.command("list", { isDefault: true })
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
	const runApp = (
		flags: DeviceFlags & { screenshot?: boolean },
		operation: string,
		value?: string,
	) =>
		client(flags.url).app(flags.device, operation, value, {
			screenshot: flags.screenshot === true,
		});

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
	appCommand("launch <app-id>", "Launch an installed app")
		.option("--json", "Print structured output")
		.option("--screenshot", "Capture the screen after the action")
		.action(async (appId: string, flags: ActionFlags) =>
			printAction(
				flags,
				(await runApp(flags, "launch", appId)) as ActionResult,
			),
		);
	appCommand("stop <app-id>", "Stop a running app")
		.option("--json", "Print structured output")
		.option("--screenshot", "Capture the screen after the action")
		.action(async (appId: string, flags: ActionFlags) =>
			printAction(flags, (await runApp(flags, "stop", appId)) as ActionResult),
		);
	appCommand("uninstall <app-id>", "Remove an installed app").action(
		async (appId: string, flags: DeviceFlags) =>
			json(await runApp(flags, "uninstall", appId)),
	);
	const permissions = program
		.command("permissions")
		.description(
			"List or change app permissions. iOS state belongs to the bundle ID and takes effect after the app requests access.",
		);
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
		.option(
			"--value <value>",
			"iOS only. Values: location=always|inuse|never, photos=limited, notifications=critical. Do not use --value for camera.",
		)
		.action(
			async (
				permission: string,
				flags: PermissionFlags & { value?: string },
			) => {
				if (flags.value && androidSerialFromStateId(flags.device))
					throw new Error("--value is available only for iOS simulators.");
				const resolvedPermission = permissionName(flags, permission);
				if (flags.value) {
					const error = permissionValueError(resolvedPermission, flags.value);
					if (error) throw new Error(error);
				}
				json(
					await client(flags.url).mutatePermissions(flags.device, {
						operation: "grant",
						bundleId: appId(flags),
						permission: resolvedPermission,
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

export function renderCliError(error: unknown): string {
	if (!(error instanceof CommandRequestError))
		return `agentsims: ${error instanceof Error ? error.message : String(error)}\n`;
	const lines = [
		`agentsims: ${error.code ? `${error.code}: ` : ""}${error.message}`,
	];
	if (error.details) {
		lines.push(`device: ${error.details.device}`);
		lines.push(
			`current devices: ${error.details.currentDeviceIds.join(", ") || "none"}`,
		);
		lines.push(`recovery: ${error.details.recovery}`);
	}
	if (error.effect) lines.push(`dispatch=${error.effect}`);
	return `${lines.join("\n")}\n`;
}

export function reportCliError(error: unknown): void {
	process.stderr.write(renderCliError(error));
	process.exitCode = 1;
}

if (import.meta.main)
	try {
		await main();
	} catch (error) {
		reportCliError(error);
	}
