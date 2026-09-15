import { describe, expect, test } from "bun:test";
import {
	normalizeAndroidPermission,
	parseRuntimePermissions,
} from "../../../../core/android/permissions";

// Captured from `dumpsys package` on a Pixel 10 emulator running Android 17.
const DUMP = `    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=163852 installed=true hidden=false
      runtime permissions:
        android.permission.POST_NOTIFICATIONS: granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]
        android.permission.ACCESS_FINE_LOCATION: granted=true, flags=[ GRANTED_BY_DEFAULT|USER_SENSITIVE_WHEN_GRANTED]
        android.permission.CAMERA: granted=false, flags=[ USER_SENSITIVE_WHEN_GRANTED|USER_SENSITIVE_WHEN_DENIED]
    disabledComponents:
      com.example.Component
`;

describe("Android runtime permissions", () => {
	test("reads the grant state and flags of each runtime permission", () => {
		expect(parseRuntimePermissions(DUMP)).toEqual([
			{
				permission: "android.permission.POST_NOTIFICATIONS",
				granted: false,
				flags: ["USER_SENSITIVE_WHEN_GRANTED", "USER_SENSITIVE_WHEN_DENIED"],
			},
			{
				permission: "android.permission.ACCESS_FINE_LOCATION",
				granted: true,
				flags: ["GRANTED_BY_DEFAULT", "USER_SENSITIVE_WHEN_GRANTED"],
			},
			{
				permission: "android.permission.CAMERA",
				granted: false,
				flags: ["USER_SENSITIVE_WHEN_GRANTED", "USER_SENSITIVE_WHEN_DENIED"],
			},
		]);
	});

	test("stops at the end of the block and tolerates a missing block", () => {
		expect(parseRuntimePermissions(DUMP)).toHaveLength(3);
		expect(parseRuntimePermissions("Package [com.example.app] (1):\n")).toEqual(
			[],
		);
	});

	// An updated system app is listed under `Packages:` and again under
	// `Hidden system packages:`. The first block is the active one.
	test("reads the first block when a package is listed twice", () => {
		const twice = `${DUMP}\n  Hidden system packages:\n      runtime permissions:\n        android.permission.CAMERA: granted=true, flags=[ ]\n`;
		const states = parseRuntimePermissions(twice);
		expect(states).toHaveLength(3);
		expect(states.at(-1)).toEqual({
			permission: "android.permission.CAMERA",
			granted: false,
			flags: ["USER_SENSITIVE_WHEN_GRANTED", "USER_SENSITIVE_WHEN_DENIED"],
		});
	});

	test("accepts a bare name, a lowercase name, and a qualified name", () => {
		expect(normalizeAndroidPermission("CAMERA")).toBe(
			"android.permission.CAMERA",
		);
		expect(normalizeAndroidPermission("camera")).toBe(
			"android.permission.CAMERA",
		);
		expect(normalizeAndroidPermission(" android.permission.camera ")).toBe(
			"android.permission.CAMERA",
		);
		expect(normalizeAndroidPermission("READ_MEDIA_IMAGES")).toBe(
			"android.permission.READ_MEDIA_IMAGES",
		);
	});

	test("keeps a vendor permission in its own namespace", () => {
		expect(
			normalizeAndroidPermission("com.google.android.gms.permission.AD_ID"),
		).toBe("com.google.android.gms.permission.AD_ID");
	});

	test("rejects a name that is not a permission", () => {
		expect(normalizeAndroidPermission("")).toBeNull();
		expect(normalizeAndroidPermission("   ")).toBeNull();
		expect(normalizeAndroidPermission("not a permission")).toBeNull();
		expect(normalizeAndroidPermission("android.permission.")).toBeNull();
	});
});
