import { describe, expect, test } from "bun:test";
import {
	arrangeWorkspaceDevicePositions,
	reserveWorkspaceDevicePosition,
	type WorkspaceDevicePosition,
} from "../../../../web/workspace/device-position";

describe("workspace device placement", () => {
	test("ignores hidden phones when appending and preserves their dragged position", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["visible", { left: 100, top: 50, right: 400, bottom: 650 }],
			["hidden", { left: 2000, top: 200, right: 2300, bottom: 800 }],
		]);
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["visible", "new"],
				"new",
				{ left: 0, top: 50, right: 200, bottom: 650 },
				true,
			),
		).toEqual({ left: 420, top: 50, right: 620, bottom: 650 });
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["visible", "hidden", "new"],
				"hidden",
				{ left: 700, top: 50, right: 1000, bottom: 650 },
				false,
			),
		).toEqual({ left: 2000, top: 200, right: 2300, bottom: 800 });
	});

	test("reserves distinct positions when multiple phones are added together", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["existing", { left: 100, top: 50, right: 400, bottom: 650 }],
		]);
		const visible = ["existing", "new-a", "new-b"];
		const a = reserveWorkspaceDevicePosition(
			positions,
			visible,
			"new-a",
			{ left: 0, top: 50, right: 250, bottom: 650 },
			true,
		);
		const b = reserveWorkspaceDevicePosition(
			positions,
			visible,
			"new-b",
			{ left: 0, top: 50, right: 300, bottom: 650 },
			true,
		);
		expect(a).toEqual({ left: 420, top: 50, right: 670, bottom: 650 });
		expect(b).toEqual({ left: 690, top: 50, right: 990, bottom: 650 });
	});

	test("retains the anchor and uses current width after resize", () => {
		const positions = new Map<string, WorkspaceDevicePosition>([
			["resized", { left: 100, top: 80, right: 400, bottom: 680 }],
		]);
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["resized", "new"],
				"resized",
				{ left: 20, top: 30, right: 620, bottom: 630 },
				false,
			),
		).toEqual({ left: 100, top: 80, right: 700, bottom: 680 });
		expect(
			reserveWorkspaceDevicePosition(
				positions,
				["resized", "new"],
				"new",
				{ left: 0, top: 50, right: 250, bottom: 650 },
				true,
			).left,
		).toBe(720);
	});
});

test("adds beside the active phone instead of the farthest phone", () => {
	const active = { left: -800, top: 200, right: -500, bottom: 800 };
	const distant = { left: 5000, top: -1000, right: 5300, bottom: -400 };
	const positions = new Map([
		["ios", active],
		["android", distant],
	]);
	const next = reserveWorkspaceDevicePosition(
		positions,
		["ios", "android", "new"],
		"new",
		{ left: 0, top: 0, right: 280, bottom: 620 },
		true,
		"ios",
	);
	expect(next).toEqual({ left: -480, top: 200, right: -200, bottom: 820 });
	expect(positions.get("ios")).toEqual(active);
	expect(positions.get("android")).toEqual(distant);
});

test("uses a free neighboring slot and does not overlap another device", () => {
	const positions = new Map([
		["active", { left: 100, top: 100, right: 400, bottom: 700 }],
		["neighbor", { left: 420, top: 100, right: 720, bottom: 700 }],
	]);
	const next = reserveWorkspaceDevicePosition(
		positions,
		["active", "neighbor", "new"],
		"new",
		{ left: 0, top: 0, right: 200, bottom: 400 },
		true,
		"active",
	);
	expect(next).toEqual({ left: 740, top: 100, right: 940, bottom: 500 });
});

test("reopening a hidden phone places it beside the current active device", () => {
	const positions = new Map([
		["active", { left: 100, top: 200, right: 400, bottom: 800 }],
		["hidden", { left: 8000, top: 3000, right: 8300, bottom: 3600 }],
	]);
	expect(
		reserveWorkspaceDevicePosition(
			positions,
			["active", "hidden"],
			"hidden",
			{ left: 0, top: 0, right: 300, bottom: 600 },
			true,
			"active",
		),
	).toEqual({ left: 420, top: 200, right: 720, bottom: 800 });
});

test("arranges on both sides of the active device without moving its anchor", () => {
	const positions = new Map([
		["ios", { left: 8000, top: 2000, right: 8300, bottom: 2600 }],
		["active", { left: -1000, top: -400, right: -600, bottom: 300 }],
		["tablet", { left: 5000, top: 6000, right: 5800, bottom: 6600 }],
		["hidden", { left: 1, top: 2, right: 301, bottom: 602 }],
	]);
	const arranged = arrangeWorkspaceDevicePositions(
		positions,
		["ios", "active", "tablet"],
		"active",
	);
	expect(arranged.get("active")).toEqual(positions.get("active"));
	expect(arranged.get("ios")).toEqual({
		left: -1320,
		top: -400,
		right: -1020,
		bottom: 200,
	});
	expect(arranged.get("tablet")).toEqual({
		left: -580,
		top: -400,
		right: 220,
		bottom: 200,
	});
	expect(arranged.has("hidden")).toBe(false);
	expect(positions.get("ios")?.left).toBe(8000);
});
