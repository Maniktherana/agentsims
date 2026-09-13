import { describe, expect, test } from "bun:test";
import {
	allPermissionNames,
	resolvePermission,
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
		expect(resolvePermission("photos")?.tccAuthVersion).toBe(2);
		expect(resolvePermission("telepathy")).toBeNull();
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
