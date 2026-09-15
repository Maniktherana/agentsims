import { expect, test } from "bun:test";
import {
	deviceActivity,
	filterDeviceRows,
	formatDeviceTable,
	type DeviceListRow,
} from "../../../cli/device-list";

const rows: DeviceListRow[] = [
	{
		device: "android:emulator-5554",
		name: "Pixel 10",
		runtime: "Android-17",
		state: "Booted",
		helper: { port: 3200 },
	},
	{
		device: "CAFD4AC3",
		name: "iPhone 17",
		runtime: "iOS-27-0",
		state: "Booted",
		helper: null,
	},
	{
		device: "android-avd:Pixel_Tablet",
		name: "Pixel Tablet",
		runtime: "Android-AVD",
		state: "Shutdown",
		helper: null,
	},
];

test("a device with a helper reads as streaming, a bare boot as booted", () => {
	expect(deviceActivity(rows[0]!)).toBe("streaming");
	expect(deviceActivity(rows[1]!)).toBe("booted");
	expect(deviceActivity(rows[2]!)).toBe("shutdown");
});

test("the active filter keeps streaming and booted devices", () => {
	expect(filterDeviceRows(rows, "active").map((row) => row.device)).toEqual([
		"android:emulator-5554",
		"CAFD4AC3",
	]);
});

test("the inactive filter is the exact complement", () => {
	expect(filterDeviceRows(rows, "inactive").map((row) => row.device)).toEqual([
		"android-avd:Pixel_Tablet",
	]);
	expect(filterDeviceRows(rows, "all")).toHaveLength(3);
});

test("the table is one line per device with aligned columns", () => {
	const lines = formatDeviceTable(rows).split("\n");
	expect(lines).toHaveLength(4);
	expect(lines[0]).toStartWith("DEVICE");
	const statusColumn = lines[0]!.indexOf("STATUS");
	for (const line of lines.slice(1))
		expect(line.slice(statusColumn)).toStartWith(
			deviceActivity(rows[lines.slice(1).indexOf(line)]!),
		);
});

test("no trailing padding on the final column", () => {
	for (const line of formatDeviceTable(rows).split("\n"))
		expect(line).toBe(line.trimEnd());
});

test("an empty list says so instead of printing a bare header", () => {
	expect(formatDeviceTable([])).toBe("No devices.");
});
