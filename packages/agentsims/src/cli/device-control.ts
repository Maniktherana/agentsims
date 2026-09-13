import type { Command } from "commander";
import { cliAction } from "./error";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseDeviceAction, type DeviceAction } from "../core/tools/input";
import type { DeviceObservation } from "../core/tools/devices/devices";
import { STATE_DIR } from "../core/tools/devices/state";
import { ApplicationCommandClient } from "./application-command-client";

export type AgentAction = DeviceAction;
export const parseAgentAction = parseDeviceAction;

export type Observation = Omit<DeviceObservation, "screenshot"> & {
	screenshot: {
		path: string;
		mimeType: string;
		bytes: number;
	};
};

type WorkspaceStatus = {
	workspaces?: Array<{ device?: string }>;
};

function client(origin?: string): ApplicationCommandClient {
	return new ApplicationCommandClient({ origin });
}

async function resolveDeviceId(
	commandClient: ApplicationCommandClient,
	device?: string,
): Promise<string> {
	if (device) return device;
	const status = (await commandClient.status()) as WorkspaceStatus;
	const selected = status.workspaces?.find(
		(workspace) => workspace.device,
	)?.device;
	if (!selected) {
		throw new Error(
			"No matching Agentsims device is running. Start `agentsims` and use `agentsims devices list` to find its device id.",
		);
	}
	return selected;
}

function screenshotExtension(mimeType: string): string {
	return mimeType.includes("png") ? ".png" : ".jpg";
}

function safeDeviceName(device: string): string {
	return device.replace(/[^0-9A-Za-z._-]+/g, "-");
}

export async function readAccessibilityTree(
	device?: string,
	origin?: string,
): Promise<unknown> {
	const commandClient = client(origin);
	const deviceId = await resolveDeviceId(commandClient, device);
	const observation = (await commandClient.observeDevice(
		deviceId,
		true,
	)) as DeviceObservation;
	if (observation.accessibility === null) {
		throw new Error(
			observation.warnings[0] ?? "Accessibility data is not available",
		);
	}
	return observation.accessibility;
}

export async function observeDevice(options: {
	device?: string;
	output?: string;
	includeAccessibility?: boolean;
	origin?: string;
}): Promise<Observation> {
	const commandClient = client(options.origin);
	const deviceId = await resolveDeviceId(commandClient, options.device);
	const observation = (await commandClient.observeDevice(
		deviceId,
		options.includeAccessibility !== false,
	)) as DeviceObservation;
	const screenshot = Buffer.from(
		observation.screenshot.contentBase64,
		"base64",
	);
	if (screenshot.byteLength !== observation.screenshot.bytes) {
		throw new Error(
			"The observation screenshot length does not match its metadata",
		);
	}
	const output = options.output
		? resolve(options.output)
		: join(
				STATE_DIR,
				"observations",
				`${safeDeviceName(deviceId)}-latest${screenshotExtension(observation.screenshot.mimeType)}`,
			);
	mkdirSync(dirname(output), { recursive: true });
	writeFileSync(output, screenshot);

	return {
		...observation,
		screenshot: {
			path: output,
			mimeType: observation.screenshot.mimeType,
			bytes: screenshot.byteLength,
		},
	};
}

export async function actOnDevice(
	action: AgentAction,
	device?: string,
	origin?: string,
): Promise<void> {
	const commandClient = client(origin);
	const deviceId = await resolveDeviceId(commandClient, device);
	await commandClient.actDevice(deviceId, [action]);
}

export async function gesture(
	json: string,
	device?: string,
	origin?: string,
): Promise<void> {
	const parsed = JSON.parse(json) as Record<string, unknown>;
	await actOnDevice(
		parseAgentAction(
			JSON.stringify({
				type: "gesture",
				phase: parsed.type,
				x: parsed.x,
				y: parsed.y,
			}),
		),
		device,
		origin,
	);
}

export async function tap(
	xValue: string,
	yValue: string,
	device?: string,
	origin?: string,
): Promise<void> {
	await actOnDevice(
		parseAgentAction(
			JSON.stringify({ type: "tap", x: Number(xValue), y: Number(yValue) }),
		),
		device,
		origin,
	);
}

export async function typeText(
	positional: string[],
	options: { device?: string; stdin?: boolean; file?: string; origin?: string },
): Promise<void> {
	const sources = [
		positional.length > 0,
		options.stdin === true,
		options.file !== undefined,
	].filter(Boolean).length;
	if (sources !== 1) {
		throw new Error(
			"Provide text as arguments, with --stdin, or with --file <path>.",
		);
	}
	const text = options.stdin
		? readFileSync(0, "utf8")
		: options.file
			? readFileSync(options.file, "utf8")
			: positional.join(" ");
	await actOnDevice({ type: "type", text }, options.device, options.origin);
}

export async function rotate(
	orientation: string,
	device?: string,
	origin?: string,
): Promise<void> {
	await actOnDevice(
		parseAgentAction(JSON.stringify({ type: "rotate", orientation })),
		device,
		origin,
	);
}

export async function button(
	name = "home",
	device?: string,
	origin?: string,
): Promise<void> {
	await actOnDevice({ type: "button", button: name }, device, origin);
}

type DeviceCliOptions = {
	device?: string;
	url?: string;
	output?: string;
	ax?: boolean;
	stdin?: boolean;
	file?: string;
};

export const DEVICE_OPTION = [
	"-d, --device <id>",
	"Target a running device id from `agentsims --list`",
] as const;

/** Legacy top-level commands use the same device operations as the workspace CLI. */
export function addCompatibilityCommands(program: Command): void {
	const command = (name: string, description: string) =>
		program
			.command(name)
			.description(description)
			.option(...DEVICE_OPTION)
			.option("--url <url>", "Agentsims server URL");

	command(
		"observe",
		"Capture one screenshot plus screen and accessibility metadata as JSON",
	)
		.option("-o, --output <path>", "Write the screenshot to this path")
		.option("--no-ax", "Skip accessibility metadata")
		.action(
			cliAction(async (options: DeviceCliOptions) => {
				const observation = await observeDevice({
					device: options.device,
					output: options.output,
					includeAccessibility: options.ax,
					origin: options.url,
				});
				process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
			}),
		);

	command(
		"act",
		"Execute one JSON action: tap, gesture, swipe, type, button, or rotate",
	)
		.argument("<json>", "Structured action JSON")
		.action(
			cliAction((json: string, options: DeviceCliOptions) =>
				actOnDevice(parseAgentAction(json), options.device, options.url),
			),
		);

	command("gesture", "Send one raw touch phase")
		.argument("<json>", `Gesture JSON, e.g. '{"type":"begin","x":0.5,"y":0.5}'`)
		.action(
			cliAction((json: string, options: DeviceCliOptions) =>
				gesture(json, options.device, options.url),
			),
		);

	command("tap", "Tap at normalized 0..1 coordinates")
		.argument("<x>", "X coordinate, normalized 0..1")
		.argument("<y>", "Y coordinate, normalized 0..1")
		.action(
			cliAction((x: string, y: string, options: DeviceCliOptions) =>
				tap(x, y, options.device, options.url),
			),
		);

	command("button", "Send a hardware button press")
		.argument("[name]", "Button name", "home")
		.action(
			cliAction((name: string, options: DeviceCliOptions) =>
				button(name, options.device, options.url),
			),
		);

	command("type", "Type text using the US keyboard layout")
		.argument("[text...]", "Text to type")
		.option("--stdin", "Read text from stdin")
		.option("--file <path>", "Read text from a file")
		.action(
			cliAction((text: string[], options: DeviceCliOptions) =>
				typeText(text, {
					device: options.device,
					stdin: options.stdin,
					file: options.file,
					origin: options.url,
				}),
			),
		);

	command(
		"rotate",
		"Set orientation: portrait, portrait_upside_down, landscape_left, or landscape_right",
	)
		.argument("<orientation>")
		.action(
			cliAction((orientation: string, options: DeviceCliOptions) =>
				rotate(orientation, options.device, options.url),
			),
		);
}
