import { describe, expect, spyOn, test } from "bun:test";
import {
	androidKeycodeForHidUsage,
	androidNightModeEnabled,
	getAndroidForegroundApp,
	parseAndroidForegroundPackage,
} from "../../../../android/device/device";

describe("Android browser keyboard mapping", () => {
	test("maps letters, digits, editing, navigation, and modifiers", () => {
		expect(androidKeycodeForHidUsage(0x04)).toBe(29); // A
		expect(androidKeycodeForHidUsage(0x1d)).toBe(54); // Z
		expect(androidKeycodeForHidUsage(0x1e)).toBe(8); // 1
		expect(androidKeycodeForHidUsage(0x27)).toBe(7); // 0
		expect(androidKeycodeForHidUsage(0x28)).toBe(66); // Enter
		expect(androidKeycodeForHidUsage(0x2a)).toBe(67); // Backspace
		expect(androidKeycodeForHidUsage(0x50)).toBe(21); // Left
		expect(androidKeycodeForHidUsage(0xe1)).toBe(59); // Left shift
	});

	test("maps function and numpad ranges and rejects unknown usages", () => {
		expect(androidKeycodeForHidUsage(0x3a)).toBe(131); // F1
		expect(androidKeycodeForHidUsage(0x45)).toBe(142); // F12
		expect(androidKeycodeForHidUsage(0x59)).toBe(145); // Numpad 1
		expect(androidKeycodeForHidUsage(0x61)).toBe(153); // Numpad 9
		expect(androidKeycodeForHidUsage(0x47)).toBeNull();
		expect(androidKeycodeForHidUsage(Number.NaN)).toBeNull();
	});
});

describe("Android app and appearance parsing", () => {
	test("reads the resumed package from modern activity output", () => {
		expect(
			parseAndroidForegroundPackage(
				"topResumedActivity=ActivityRecord{67737664 u0 ai.puch/.MainActivity t85}",
			),
		).toBe("ai.puch");
		expect(
			parseAndroidForegroundPackage(
				"mResumedActivity: ActivityRecord{1 u0 com.example/.Main t2}",
			),
		).toBe("com.example");
		expect(parseAndroidForegroundPackage("no resumed app")).toBeNull();
	});

	test("reads Android night mode output", () => {
		expect(androidNightModeEnabled("Night mode: yes")).toBe(true);
		expect(androidNightModeEnabled("Night mode: no")).toBe(false);
		expect(androidNightModeEnabled("Night mode: 2")).toBe(true);
	});

	test("returns no foreground app when the selected emulator disappears", async () => {
		const calls: string[][] = [];
		const execute = async (args: string[]): Promise<string> => {
			calls.push(args);
			throw new Error("adb: device 'emulator-gone' not found");
		};

		expect(await getAndroidForegroundApp("emulator-gone", execute)).toBeNull();
		expect(calls).toHaveLength(1);
	});

	test("memoizes a non-debuggable foreground process without warning", async () => {
		const calls: string[][] = [];
		const warn = spyOn(console, "warn").mockImplementation(() => {});
		const execute = async (args: string[]): Promise<string> => {
			calls.push(args);
			if (args.includes("dumpsys")) {
				return "topResumedActivity=ActivityRecord{1 u0 com.example.launcher/.Main t2}";
			}
			if (args.includes("pidof")) return "4242";
			if (args.includes("logcat")) return "";
			throw new Error("run-as: package not debuggable: com.example.launcher");
		};

		try {
			const expected = {
				bundleId: "com.example.launcher",
				pid: 4242,
				isReactNative: false,
			};
			expect(await getAndroidForegroundApp("emulator-test", execute)).toEqual(
				expected,
			);
			expect(await getAndroidForegroundApp("emulator-test", execute)).toEqual(
				expected,
			);
			expect(calls.filter((args) => args.includes("logcat"))).toHaveLength(1);
			expect(calls.filter((args) => args.includes("run-as"))).toHaveLength(1);
			expect(warn).not.toHaveBeenCalled();
		} finally {
			warn.mockRestore();
		}
	});
});
