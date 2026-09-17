import { describe, expect, test } from "bun:test";
import {
	allPermissionNames,
	permissionValueError,
	resolvePermission,
	setPermission,
} from "../../../../core/ios/permissions";

describe("iOS permission catalogue", () => {
	test("maps notification, location, camera, and photos permissions", () => {
		expect(resolvePermission("notifications")?.kind).toBe("notifications");
		expect(resolvePermission("location")?.values).toEqual([
			"always",
			"inuse",
			"never",
		]);
		expect(resolvePermission("camera")?.tccService).toBe("kTCCServiceCamera");
		expect(resolvePermission("camera")?.values).toBeUndefined();
		expect(resolvePermission("photos")?.tccAuthVersion).toBe(2);
		expect(resolvePermission("photos")?.values).toEqual(["limited"]);
		expect(resolvePermission("notifications")?.values).toEqual(["critical"]);
		expect(resolvePermission("telepathy")).toBeNull();
	});

	test("reports the valid values for each permission", async () => {
		expect(permissionValueError("camera", "always")).toBe(
			"camera does not take --value.",
		);
		expect(permissionValueError("location", "limited")).toBe(
			"Invalid --value for location: limited. Use always, inuse, or never.",
		);
		expect(permissionValueError("photos", "always")).toBe(
			"Invalid --value for photos: always. Use limited.",
		);
		expect(permissionValueError("notifications", "always")).toBe(
			"Invalid --value for notifications: always. Use critical.",
		);
		expect(permissionValueError("location", "inuse")).toBeNull();

		await expect(
			setPermission(
				"EA490A70-320C-4CE1-A8F9-55A7116CAFD9",
				"grant",
				"camera",
				"com.example.app",
				"always",
			),
		).rejects.toThrow("camera does not take --value.");
	});

	test("lists all canonical permissions", () => {
		expect(allPermissionNames()).toEqual(
			expect.arrayContaining([
				"notifications",
				"location",
				"camera",
				"media-library",
			]),
		);
	});
});
