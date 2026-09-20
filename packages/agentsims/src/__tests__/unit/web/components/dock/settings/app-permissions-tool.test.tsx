import { describe, expect, test } from "bun:test";
import { permissionStateFromList } from "../../../../../../web/components/dock/settings/app-permissions-tool";

describe("permissionStateFromList", () => {
	test("distinguishes denied, while-in-use, and always location states", () => {
		const state = (Authorization: number) =>
			permissionStateFromList({
				tcc: { camera: 0, photos: 3 },
				location: { Authorization },
				notifications: { allowsNotifications: true },
			});

		expect(state(1)).toMatchObject({
			camera: "revoke",
			photos: "grant",
			location: "revoke",
			"location-always": "revoke",
			notifications: "grant",
		});
		expect(state(2)).toMatchObject({
			location: "grant",
			"location-always": "revoke",
		});
		expect(state(4)).toMatchObject({
			location: "grant",
			"location-always": "grant",
		});
	});
});
