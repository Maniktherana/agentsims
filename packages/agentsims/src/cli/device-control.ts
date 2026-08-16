import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
	parseDeviceAction,
	type DeviceAction,
} from "../commands/device-actions";
import type { DeviceObservation } from "../commands/device-observation";
import { STATE_DIR } from "../shared/state";
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
