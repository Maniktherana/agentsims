import type { DeviceLifecyclePhase } from "../components/dock/devices/device-row";
import type { GridDevice } from "./grid";

/** A start that the user asked for. `resolved` is set when the server names the live device. */
export interface DeviceLaunch {
	requested: string;
	resolved: string | null;
}

type CatalogDevice = Pick<GridDevice, "device" | "catalogDevice">;

export function catalogDeviceFor<T extends CatalogDevice>(
	devices: readonly T[] | null,
	deviceId: string,
): T | null {
	if (!devices) return null;
	return (
		devices.find((device) => device.device === deviceId) ??
		devices.find((device) => device.catalogDevice === deviceId) ??
		null
	);
}

/**
 * Devices that are on the canvas but do not stream yet. A launch keeps its
 * slot until its device is visible. The focused device keeps its slot while it
 * is shut down, boots, or attaches. A device that the catalog does not know
 * gets no slot, so a loading catalog shows the empty canvas.
 */
export function pendingCanvasDeviceIds({
	visibleDeviceIds,
	focusedDeviceId,
	launches,
	devices,
}: {
	visibleDeviceIds: readonly string[];
	focusedDeviceId: string | null;
	launches: readonly DeviceLaunch[];
	devices: readonly CatalogDevice[] | null;
}): string[] {
	if (!devices) return [];
	const visible = new Set(visibleDeviceIds);
	const pending: string[] = [];
	const add = (deviceId: string) => {
		if (visible.has(deviceId) || pending.includes(deviceId)) return;
		if (!catalogDeviceFor(devices, deviceId)) return;
		pending.push(deviceId);
	};
	for (const launch of launches) {
		if (launch.resolved && visible.has(launch.resolved)) continue;
		add(launch.requested);
	}
	if (focusedDeviceId) add(focusedDeviceId);
	return pending;
}

/** Visible devices keep their order. Pending devices follow, where new devices appear. */
export function canvasDeviceIds(
	visibleDeviceIds: readonly string[],
	pendingDeviceIds: readonly string[],
): string[] {
	if (pendingDeviceIds.length === 0) return [...visibleDeviceIds];
	return [...visibleDeviceIds, ...pendingDeviceIds];
}

/** Drop launches whose device is now visible or that the user removed. */
export function settledDeviceLaunches(
	launches: readonly DeviceLaunch[],
	visibleDeviceIds: readonly string[],
): DeviceLaunch[] {
	const visible = new Set(visibleDeviceIds);
	const next = launches.filter(
		(launch) =>
			!visible.has(launch.requested) &&
			!(launch.resolved && visible.has(launch.resolved)),
	);
	return next.length === launches.length ? (launches as DeviceLaunch[]) : next;
}

export type PendingDeviceAction = "start" | "connect" | "retry";

export interface PendingDevicePresentation {
	phase: DeviceLifecyclePhase;
	/** The status label when the phase does not name one. */
	status: string;
	action: PendingDeviceAction | null;
	error: string | null;
}

/** What a device on the canvas shows before its first frame. */
export function pendingDevicePresentation(
	device: Pick<GridDevice, "helper" | "state"> | null,
	{
		starting,
		shuttingDown,
		error,
	}: { starting: boolean; shuttingDown: boolean; error: string | null },
): PendingDevicePresentation {
	if (!device)
		return {
			phase: "connecting",
			status: "Connecting",
			action: null,
			error: null,
		};
	const state = device.state.trim().toLowerCase();
	if (shuttingDown || state === "shutting down")
		return {
			phase: "shutting-down",
			status: "Shutting down",
			action: null,
			error: null,
		};
	if (state === "booting" || state === "creating" || (starting && state !== "booted"))
		return { phase: "booting", status: "Booting", action: null, error: null };
	if (starting)
		return {
			phase: "connecting",
			status: "Connecting",
			action: null,
			error: null,
		};
	if (error)
		return { phase: "available", status: "Not started", action: "retry", error };
	if (device.helper)
		return {
			phase: "connecting",
			status: "Connecting",
			action: null,
			error: null,
		};
	if (device.state === "Booted")
		return {
			phase: "available",
			status: "Not connected",
			action: "connect",
			error: null,
		};
	return { phase: "available", status: "Shut down", action: "start", error: null };
}
