import type { AndroidToolAction } from "../../../android/contracts";
import { shellEscape, type ExecResult } from "../../simulator/input/exec";

export type LocationPoint = { lat: number; lng: number; altitude?: number };

export function locationSetCommand(udid: string, point: LocationPoint): string {
	if (udid.startsWith("android:"))
		throw new Error("Android location uses the shared command API");
	return `xcrun simctl location ${shellEscape(udid)} set ${point.lat.toFixed(7)},${point.lng.toFixed(7)}`;
}

/** Keep Android route playback on the same validated API as a one-shot location. */
export async function setDeviceLocation(
	udid: string,
	point: LocationPoint,
	adapters: {
		exec(command: string): Promise<ExecResult>;
		android(device: string, action: AndroidToolAction): Promise<unknown>;
	},
): Promise<ExecResult> {
	if (!udid.startsWith("android:"))
		return adapters.exec(locationSetCommand(udid, point));
	await adapters.android(udid, {
		type: "location",
		latitude: point.lat,
		longitude: point.lng,
		...(point.altitude === undefined ? {} : { altitude: point.altitude }),
	});
	return { stdout: "", stderr: "", exitCode: 0 };
}
