import { describe, expect, test } from "bun:test";
import {
	canvasDeviceIds,
	pendingCanvasDeviceIds,
	pendingDevicePresentation,
	settledDeviceLaunches,
} from "../../../../web/workspace/canvas-devices";

const catalog = [
	{ device: "ios-live" },
	{ device: "ios-off" },
	{ device: "android-avd:Pixel_9" },
	{ device: "android:emulator-5554", catalogDevice: "android-avd:Pixel_9" },
];

describe("canvas devices", () => {
	test("a loading catalog and an empty workspace place no device", () => {
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: "ios-off",
				launches: [{ requested: "ios-off", resolved: null }],
				devices: null,
			}),
		).toEqual([]);
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: null,
				launches: [],
				devices: catalog,
			}),
		).toEqual([]);
	});

	test("a started device keeps one slot from the start request until it streams", () => {
		const starting = pendingCanvasDeviceIds({
			visibleDeviceIds: ["ios-live"],
			focusedDeviceId: "ios-live",
			launches: [{ requested: "ios-off", resolved: null }],
			devices: catalog,
		});
		expect(canvasDeviceIds(["ios-live"], starting)).toEqual([
			"ios-live",
			"ios-off",
		]);

		// The same ID becomes visible. The slot moves to the visible list, in the same place.
		const live = pendingCanvasDeviceIds({
			visibleDeviceIds: ["ios-live", "ios-off"],
			focusedDeviceId: "ios-off",
			launches: [{ requested: "ios-off", resolved: "ios-off" }],
			devices: catalog,
		});
		expect(live).toEqual([]);
		expect(canvasDeviceIds(["ios-live", "ios-off"], live)).toEqual([
			"ios-live",
			"ios-off",
		]);
	});

	test("an Android launch keeps its catalog slot until the live serial is visible", () => {
		const launches = [
			{ requested: "android-avd:Pixel_9", resolved: "android:emulator-5554" },
		];
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: null,
				launches,
				devices: catalog,
			}),
		).toEqual(["android-avd:Pixel_9"]);
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: ["android:emulator-5554"],
				focusedDeviceId: null,
				launches,
				devices: catalog,
			}),
		).toEqual([]);
		expect(
			settledDeviceLaunches(launches, ["android:emulator-5554"]),
		).toEqual([]);
	});

	test("a failed launch keeps its slot and shows a retry with the error", () => {
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: null,
				launches: [{ requested: "ios-off", resolved: null }],
				devices: catalog,
			}),
		).toEqual(["ios-off"]);
		expect(
			pendingDevicePresentation(
				{ state: "Shutdown", helper: null },
				{ starting: false, shuttingDown: false, error: "HTTP 500" },
			),
		).toEqual({
			phase: "available",
			status: "Not started",
			action: "retry",
			error: "HTTP 500",
		});
	});

	test("the focused device keeps a slot while shut down and gets no duplicate", () => {
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: "ios-off",
				launches: [{ requested: "ios-off", resolved: null }],
				devices: catalog,
			}),
		).toEqual(["ios-off"]);
		expect(
			pendingCanvasDeviceIds({
				visibleDeviceIds: [],
				focusedDeviceId: "unknown",
				launches: [],
				devices: catalog,
			}),
		).toEqual([]);
	});

	test("settled launches keep the same list when nothing became visible", () => {
		const launches = [{ requested: "ios-off", resolved: null }];
		expect(settledDeviceLaunches(launches, ["ios-live"])).toBe(launches);
	});

	test("each lifecycle state has one status and at most one action", () => {
		const off = { state: "Shutdown", helper: null };
		const booted = { state: "Booted", helper: null };
		const attached = {
			state: "Booted",
			helper: { port: 1, url: "", streamUrl: "", wsUrl: "" },
		};
		const none = { starting: false, shuttingDown: false, error: null };
		expect(pendingDevicePresentation(off, none)).toMatchObject({
			phase: "available",
			action: "start",
		});
		expect(
			pendingDevicePresentation(off, { ...none, starting: true }),
		).toMatchObject({ phase: "booting", action: null });
		expect(
			pendingDevicePresentation(
				{ state: "Booting", helper: null },
				none,
			),
		).toMatchObject({ phase: "booting", action: null });
		expect(
			pendingDevicePresentation(booted, { ...none, starting: true }),
		).toMatchObject({ phase: "connecting", action: null });
		expect(pendingDevicePresentation(booted, none)).toMatchObject({
			phase: "available",
			action: "connect",
		});
		expect(pendingDevicePresentation(attached, none)).toMatchObject({
			phase: "connecting",
			action: null,
		});
		expect(
			pendingDevicePresentation(booted, { ...none, shuttingDown: true }),
		).toMatchObject({ phase: "shutting-down", action: null });
	});
});
