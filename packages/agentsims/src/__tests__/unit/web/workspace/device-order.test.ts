import { expect, test } from "bun:test";
import { reconcileWorkspaceDeviceOrder } from "../../../../web/workspace/device-order";

test("catalog sorting and reconnects retain device order; new devices append once", () => {
	const initial = reconcileWorkspaceDeviceOrder([], ["ios", "android"]);
	const disconnected = reconcileWorkspaceDeviceOrder(initial, ["android"]);
	const reconnected = reconcileWorkspaceDeviceOrder(disconnected, [
		"android",
		"new",
		"ios",
		"new",
	]);
	expect(initial).toEqual(["ios", "android"]);
	expect(reconnected).toEqual(["ios", "android", "new"]);
});
