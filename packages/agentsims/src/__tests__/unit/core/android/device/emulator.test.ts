import { expect, test } from "bun:test";
import { waitForAndroidBoot } from "../../../../../core/android/device/emulator";

test("waits for Android boot completion and the window service", async () => {
	let now = 0;
	let bootChecks = 0;
	let windowChecks = 0;

	const result = await waitForAndroidBoot("emulator-5554", 10_000, {
		execute: async (args) => {
			if (args.includes("getprop")) {
				bootChecks += 1;
				return bootChecks === 1 ? "" : "1\n";
			}
			windowChecks += 1;
			return windowChecks === 1
				? "Service window: not found\n"
				: "Service window: found\n";
		},
		now: () => now,
		delay: async (milliseconds) => {
			now += milliseconds;
		},
	});

	expect(result).toEqual({ ready: true });
	expect(bootChecks).toBe(3);
	expect(windowChecks).toBe(2);
});

test("returns the last framework failure when Android never becomes ready", async () => {
	let now = 0;
	let checks = 0;

	const result = await waitForAndroidBoot("emulator-5554", 2_500, {
		execute: async (args) => {
			if (args.includes("getprop")) return "1\n";
			checks += 1;
			return "Service window: not found\n";
		},
		now: () => now,
		delay: async (milliseconds) => {
			now += milliseconds;
		},
	});

	expect(result).toEqual({
		ready: false,
		error: "Service window: not found",
	});
	expect(checks).toBe(3);
});
