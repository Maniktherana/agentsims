import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import { commandText } from "../host";

export const SIMCTL_LIST_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

export type IosSimulatorDevice = {
	udid: string;
	name: string;
	state: string;
	isAvailable?: boolean;
	deviceTypeIdentifier?: string;
};

/** Keep the runtime groups and unavailable devices so callers retain their own selection policy. */
export async function listIosDevices(
	options: {
		booted?: boolean;
		platform?: NodeJS.Platform;
		timeoutMs?: number;
	} = {},
): Promise<Record<string, IosSimulatorDevice[]> | null> {
	if ((options.platform ?? process.platform) !== "darwin") return null;
	try {
		const command = commandText(
			"xcrun",
			"simctl",
			"list",
			"devices",
			...(options.booted ? ["booted"] : []),
			"-j",
		);
		const output = await Effect.runPromise(
			(options.timeoutMs === undefined
				? command
				: command.pipe(Effect.timeout(options.timeoutMs))
			).pipe(Effect.provide(BunContext.layer)),
		);
		return (
			JSON.parse(output) as { devices: Record<string, IosSimulatorDevice[]> }
		).devices;
	} catch {
		return null;
	}
}

export async function findBootedDevice(): Promise<string | null> {
	const devicesByRuntime = await listIosDevices({ booted: true });
	if (!devicesByRuntime) return null;
	let fallback: string | null = null;
	for (const [runtime, devices] of Object.entries(devicesByRuntime)) {
		for (const device of devices) {
			if (device.state !== "Booted") continue;
			if (/iOS/i.test(runtime)) return device.udid;
			fallback ??= device.udid;
		}
	}
	return fallback;
}

export async function resolveDevice(nameOrUDID: string): Promise<string> {
	if (
		/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(
			nameOrUDID,
		)
	) {
		return nameOrUDID;
	}
	const devicesByRuntime = await listIosDevices();
	if (devicesByRuntime) {
		for (const runtime of Object.values(devicesByRuntime)) {
			for (const device of runtime) {
				if (device.name.toLowerCase() === nameOrUDID.toLowerCase())
					return device.udid;
			}
		}
	}
	throw new Error(`Could not resolve device: ${nameOrUDID}`);
}
