import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
	performAndroidAppAction,
	readAndroidAppDetails,
} from "../../../../../core/android/device/app-tools";
import { CommandFailure } from "../../../../../core/tools/errors";

test("apps preserve the package list and classify system apps from pm rather than package names", async () => {
	const result = await Effect.runPromise(
		performAndroidAppAction(
			(serial, args) => {
				expect(serial).toBe("physical-device");
				return Effect.succeed(
					args[1]?.endsWith("'-s'")
						? "package:org.vendor.core\r\n"
						: "package:com.google.userapp\r\npackage:org.vendor.core\r\npackage:com.example.app\r\n",
				);
			},
			"physical-device",
			{ type: "apps" },
		),
	);
	expect(result).toEqual({
		packages: ["com.example.app", "com.google.userapp", "org.vendor.core"],
		apps: [
			{ package: "com.example.app", system: false },
			{ package: "com.google.userapp", system: false },
			{ package: "org.vendor.core", system: true },
		],
	});
});
test("apps cannot silently classify everything as user installed when the system query fails", async () => {
	await expect(
		Effect.runPromise(
			performAndroidAppAction(
				(_serial, args) =>
					args[1]?.endsWith("'-s'")
						? Effect.fail(
								new CommandFailure({ message: "device disconnected" }),
							)
						: Effect.succeed("package:com.example.app"),
				"emulator-5554",
				{ type: "apps" },
			),
		),
	).rejects.toThrow("device disconnected");
});

test("reads the installed application label, versions, and rendered icon from the device helper", async () => {
	const calls: readonly string[][] = [];
	const mutableCalls = calls as string[][];
	const result = await Effect.runPromise(
		readAndroidAppDetails(
			(serial, args) => {
				expect(serial).toBe("emulator-5554");
				mutableCalls.push([...args]);
				return Effect.succeed(
					args[0] === "push"
						? "uploaded"
						: JSON.stringify({
								bundleId: "com.example.fixture",
								displayName: "Fixture App",
								shortVersion: "1.2.3",
								bundleVersion: "42",
								iconDataUrl: "data:image/png;base64,fixture",
							}),
				);
			},
			"emulator-5554",
			"com.example.fixture",
		),
	);
	expect(result).toMatchObject({
		displayName: "Fixture App",
		iconDataUrl: "data:image/png;base64,fixture",
	});
	expect(calls).toHaveLength(2);
	expect(calls[1]?.[1]).toContain("metadata 'com.example.fixture'");
});
