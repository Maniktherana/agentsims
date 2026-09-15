import { formatFields, formatTable } from "./output";

export type DeviceListFilter = "all" | "active" | "inactive";

export interface DeviceListRow {
	device: string;
	name: string;
	runtime: string;
	state: string;
	helper: unknown;
}

export function deviceActivity(row: DeviceListRow): string {
	if (row.helper) return "streaming";
	return row.state === "Booted" ? "booted" : row.state.toLowerCase();
}

export function isActiveDevice(row: DeviceListRow): boolean {
	return !!row.helper || row.state === "Booted";
}

export function filterDeviceRows(
	rows: DeviceListRow[],
	filter: DeviceListFilter,
): DeviceListRow[] {
	if (filter === "all") return rows;
	const active = filter === "active";
	return rows.filter((row) => isActiveDevice(row) === active);
}

export function formatDeviceTable(
	rows: DeviceListRow[],
	empty = "No devices.",
): string {
	return formatTable(
		["DEVICE", "STATUS", "RUNTIME", "NAME"],
		rows.map((row) => [row.device, deviceActivity(row), row.runtime, row.name]),
		empty,
	);
}

/** An empty list is not an error, but it must still say what to do next. */
export function emptyDeviceMessage(
	filter: DeviceListFilter,
	total: number,
): string {
	if (total === 0)
		return "No devices found. Run `agentsims doctor` to check the host setup.";
	if (filter === "inactive") return "Every known device is active.";
	return [
		`No active devices. ${total} available.`,
		"  agentsims devices --all          list them",
		"  agentsims devices boot <device>  start one",
	].join("\n");
}

export function formatDeviceDetail(row: DeviceListRow): string {
	return [
		`${row.name}  ·  ${row.runtime}  ·  ${deviceActivity(row)}`,
		formatFields([
			["id", row.device],
			...(row.helper && typeof row.helper === "object"
				? ([["helper", String((row.helper as { url?: string }).url ?? "")]] as [
						string,
						string,
					][])
				: []),
		]),
	].join("\n");
}
