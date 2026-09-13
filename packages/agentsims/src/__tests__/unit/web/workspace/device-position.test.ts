import { describe, expect, test } from "bun:test";
import {
	reserveWorkspaceDevicePosition,
	type WorkspaceDevicePosition,
} from "../../../../web/workspace/device-position";

describe("workspace device placement", () => {
	test("ignores hidden phones when appending and preserves their dragged position", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["visible", { left: 100, top: 50, right: 400 }],
			["hidden", { left: 2000, top: 200, right: 2300 }],
		]);
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["visible", "new"],
				"new",
				{ left: 0, top: 50, right: 200 },
				true,
			),
		).toEqual({ left: 420, top: 50, right: 620 });
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["visible", "hidden", "new"],
				"hidden",
				{ left: 700, top: 50, right: 1000 },
				false,
			),
		).toEqual({ left: 2000, top: 200, right: 2300 });
	});

	test("reserves distinct positions when multiple phones are added together", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["existing", { left: 100, top: 50, right: 400 }],
		]);
		const visible = ["existing", "new-a", "new-b"];
		const a = reserveWorkspaceDevicePosition(
			positions,
			visible,
			"new-a",
			{ left: 0, top: 50, right: 250 },
			true,
		);
		const b = reserveWorkspaceDevicePosition(
			positions,
			visible,
			"new-b",
			{ left: 0, top: 50, right: 300 },
			true,
		);
		expect(a).toEqual({ left: 420, top: 50, right: 670 });
		expect(b).toEqual({ left: 690, top: 50, right: 990 });
	});

	test("retains the anchor and uses current width after resize", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["resized", { left: 100, top: 80, right: 400 }],
		]);
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["resized", "new"],
				"resized",
				{ left: 20, top: 30, right: 620 },
				false,
			),
		).toEqual({ left: 100, top: 80, right: 700 });
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["resized", "new"],
				"new",
				{ left: 0, top: 50, right: 250 },
				true,
			).left,
		).toBe(720);
	});
});
