import { describe, expect, test } from "bun:test";
import {
	partitionDevicePickerDevices,
	reconcileDevicePhaseAnnouncements,
} from "../../../../../web/components/workspace/workspace-header";
import type { GridDevice } from "../../../../../web/workspace/grid";

const devices: GridDevice[] = [
	{
		device: "ios-one",
		name: "iPhone 16",
		runtime: "iOS-26-5",
		state: "Booted",
		helper: {
			port: 3211,
			url: "http://localhost:3211",
			streamUrl: "http://localhost:3211/stream.mjpeg",
			wsUrl: "ws://localhost:3211",
		},
	},
	{
		device: "android:emulator-5554",
		name: "Pixel 10",
		runtime: "Android-17",
		state: "Shutdown",
		helper: null,
	},
];

describe("WorkspaceHeader", () => {
	test("keeps every transitional device in Running and only settled shutdowns in Available", () => {
		const booting = {
			...devices[1]!,
			device: "ios-booting",
			name: "iPhone booting",
		};
		const connecting = {
			...devices[1]!,
			device: "ios-connecting",
			name: "iPhone connecting",
			state: "Booted",
		};
		const shutting = {
			...devices[0]!,
			device: "ios-shutting",
			name: "iPhone shutting",
			helper: null,
		};
		const partitioned = partitionDevicePickerDevices(
			[devices[0]!, devices[1]!, booting, connecting, shutting],
			{ [booting.device]: true },
			{ [shutting.device]: true },
		);

		expect(partitioned.runningDevices.map((device) => device.device)).toEqual([
			"ios-one",
			"ios-booting",
			"ios-connecting",
			"ios-shutting",
		]);
		expect(partitioned.availableDevices.map((device) => device.device)).toEqual(
			["android:emulator-5554"],
		);
	});

	test("moves shutdown progress to Available only after the action settles", () => {
		const shutting = { ...devices[0]!, helper: null };
		expect(
			partitionDevicePickerDevices([shutting], {}, { [shutting.device]: true })
				.runningDevices,
		).toHaveLength(1);

		const settled = { ...shutting, state: "Shutdown" };
		expect(partitionDevicePickerDevices([settled], {}, {})).toEqual({
			runningDevices: [],
			availableDevices: [settled],
		});
	});

	test("keeps native simulator transitions in Running after reload", () => {
		const nativeTransitions = ["Booting", "Creating", "Shutting Down"].map(
			(state, index) => ({
				...devices[1]!,
				device: `native-transition-${index}`,
				state,
			}),
		);
		const partitioned = partitionDevicePickerDevices(nativeTransitions, {}, {});
		expect(partitioned.runningDevices).toEqual(nativeTransitions);
		expect(partitioned.availableDevices).toEqual([]);
	});

	test("announces only phase changes and includes settled completion", () => {
		const initial = reconcileDevicePhaseAnnouncements(
			null,
			[devices[1]!],
			{},
			{},
		);
		expect(initial.announcement).toBe("");

		const unchanged = reconcileDevicePhaseAnnouncements(
			initial.phases,
			[devices[1]!],
			{},
			{},
		);
		expect(unchanged.announcement).toBe("");

		const bootingDevice = { ...devices[1]!, state: "Booting" };
		const booting = reconcileDevicePhaseAnnouncements(
			unchanged.phases,
			[bootingDevice],
			{},
			{},
		);
		expect(booting.announcement).toBe("Pixel 10: Booting · Android 17");

		const settledDevice = { ...bootingDevice, state: "Shutdown" };
		const settled = reconcileDevicePhaseAnnouncements(
			booting.phases,
			[settledDevice],
			{},
			{},
		);
		expect(settled.announcement).toBe("Pixel 10: Available · Android 17");
	});
});
