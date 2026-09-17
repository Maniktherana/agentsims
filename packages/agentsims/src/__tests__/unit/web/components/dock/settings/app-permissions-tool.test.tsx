import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	AppPermissionsLoading,
	AppPermissionsTool,
	permissionStateFromList,
} from "../../../../../../web/components/dock/settings/app-permissions-tool";

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

describe("AppPermissionsLoading", () => {
	test("marks unavailable permissions as busy and disabled", () => {
		const html = renderToStaticMarkup(<AppPermissionsLoading />);

		expect(html).toContain("Permissions");
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain(
			"Permissions appear once an app is in the foreground",
		);
	});

	test("renders for the permissions tool while foreground app data is missing", () => {
		const html = renderToStaticMarkup(
			<AppPermissionsTool udid="booted" bundleId={null} />,
		);

		expect(html).toContain("Permissions");
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain(
			"Permissions appear once an app is in the foreground",
		);
	});
});
