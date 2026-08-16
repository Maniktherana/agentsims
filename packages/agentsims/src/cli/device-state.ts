import { execSync } from "child_process";
import { existsSync, readFileSync, unlinkSync } from "fs";
import { androidSerialFromStateId } from "../android/device/device";
import { SIMCTL_LIST_MAX_BUFFER_BYTES } from "../ios/device/device";
import { debugState } from "../shared/debug";
import {
	listStateFiles,
	stateFileForDevice,
	type DeviceState,
} from "../shared/state";

export type ServerState = DeviceState;

let bootedSnapshot: { at: number; booted: Set<string> | null } = {
	at: 0,
	booted: null,
};

function getBootedUdids(): Set<string> | null {
	const now = Date.now();
	if (bootedSnapshot.booted && now - bootedSnapshot.at < 1000) {
		return bootedSnapshot.booted;
	}
	try {
		const output = execSync("xcrun simctl list devices booted -j", {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 3_000,
			maxBuffer: SIMCTL_LIST_MAX_BUFFER_BYTES,
		});
		const data = JSON.parse(output) as {
			devices: Record<string, Array<{ udid: string; state: string }>>;
		};
		const booted = new Set<string>();
		for (const runtime of Object.values(data.devices)) {
			for (const device of runtime) {
				if (device.state === "Booted") booted.add(device.udid);
			}
		}
		bootedSnapshot = { at: now, booted };
		return booted;
	} catch {
		return null;
	}
}

function readStateFile(file: string): ServerState | null {
	try {
		if (!existsSync(file)) {
			debugState("state file missing %s", file);
			return null;
		}
		const state = JSON.parse(readFileSync(file, "utf-8")) as ServerState;
		try {
			process.kill(state.pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EPERM") return state;
			debugState(
				"helper pid %d dead, removing stale state %s",
				state.pid,
				file,
			);
			unlinkSync(file);
			return null;
		}

		const booted = getBootedUdids();
		if (
			!androidSerialFromStateId(state.device) &&
			booted &&
			!booted.has(state.device)
		) {
			if (state.pid === process.pid) {
				debugState(
					"dropping own stale state for non-booted device %s",
					state.device,
				);
				try {
					unlinkSync(file);
				} catch (error) {
					console.warn("[agentsims:cli] recoverable operation failed", error);
				}
				return null;
			}
			debugState(
				"helper pid %d bound to non-booted device %s — killing stale helper",
				state.pid,
				state.device,
			);
			console.error(
				`[agentsims] Helper pid ${state.pid} is bound to device ${state.device} which is no longer booted — killing stale helper.`,
			);
			try {
				process.kill(state.pid, "SIGTERM");
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
			try {
				unlinkSync(file);
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
			return null;
		}
		debugState(
			"state ok pid=%d device=%s port=%d",
			state.pid,
			state.device,
			state.port,
		);
		return state;
	} catch (error) {
		debugState("readStateFile threw for %s: %o", file, error);
		return null;
	}
}

export function readState(device?: string): ServerState | null {
	if (device) return readStateFile(stateFileForDevice(device));
	for (const file of listStateFiles()) {
		const state = readStateFile(file);
		if (state) return state;
	}
	return null;
}

export function readAllStates(): ServerState[] {
	const states: ServerState[] = [];
	for (const file of listStateFiles()) {
		const state = readStateFile(file);
		if (state) states.push(state);
	}
	return states;
}
