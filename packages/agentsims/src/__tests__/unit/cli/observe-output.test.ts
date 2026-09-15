import { expect, test } from "bun:test";
import {
	countNodes,
	normalizeAx,
	observationFileName,
	renderAx,
	renderObservation,
	shotsToPrune,
} from "../../../cli/observe-output";

const iosTree = [
	{
		type: "Application",
		AXLabel: null,
		frame: { x: 0, y: 0, width: 402, height: 874 },
		children: [
			{
				type: "Button",
				AXLabel: "Settings",
				frame: { x: 306, y: 389, width: 68, height: 91 },
				children: [],
			},
		],
	},
];

const androidPayload = {
	screen: { width: 1080, height: 2424 },
	elements: [
		{
			path: "0",
			role: "android.widget.FrameLayout",
			label: "",
			frame: { x: 0, y: 0, width: 1080, height: 2424 },
		},
		{
			path: "0.1",
			role: "android.widget.TextView",
			label: "Sign in",
			frame: { x: 10, y: 20, width: 100, height: 40 },
		},
	],
};

test("the iOS nested tree keeps its hierarchy", () => {
	const nodes = normalizeAx(iosTree);
	expect(countNodes(nodes)).toBe(2);
	expect(nodes[0]!.children[0]!.label).toBe("Settings");
});

test("Android's {screen,elements} payload nests by dotted path", () => {
	const nodes = normalizeAx(androidPayload);
	expect(nodes).toHaveLength(1);
	expect(nodes[0]!.type).toBe("android.widget.FrameLayout");
	expect(nodes[0]!.children[0]!.label).toBe("Sign in");
	expect(countNodes(nodes)).toBe(2);
});

test("a bare array is still accepted", () => {
	expect(normalizeAx(iosTree)).toHaveLength(1);
	expect(normalizeAx(null)).toHaveLength(0);
});

test("each element is one line, indented by depth, with its frame", () => {
	const lines = renderAx(normalizeAx(iosTree));
	expect(lines).toHaveLength(2);
	expect(lines[0]).toBe("Application  tap 0.500,0.500");
	expect(lines[1]).toBe('  Button  "Settings"  tap 0.846,0.497');
});

test("tap coordinates come from the tree's own space, not the screenshot's", () => {
	// iOS reports points (402x874) while the screenshot is 1206x2622.
	const lines = renderAx(normalizeAx(iosTree));
	const tap = lines[1]!.match(/tap ([0-9.]+),([0-9.]+)/)!;
	expect(Number(tap[1])).toBeCloseTo((306 + 68 / 2) / 402, 3);
	expect(Number(tap[2])).toBeCloseTo((389 + 91 / 2) / 874, 3);
});

test("a huge tree is capped and says how to get the rest", () => {
	const many = Array.from({ length: 50 }, (_, i) => ({
		type: "Cell",
		label: `row ${i}`,
		frame: { x: 0, y: i, width: 10, height: 10 },
		children: [],
	}));
	const out = renderObservation({ accessibility: many }, "/tmp/x.png");
	expect(renderAx(normalizeAx(many), 10)).toHaveLength(10);
	expect(out).toContain("elements  50");
});

test("the screenshot path and screen size lead the output", () => {
	const out = renderObservation(
		{ config: { width: 402, height: 874, orientation: "portrait" }, accessibility: iosTree },
		"/tmp/shot.png",
	);
	expect(out.split("\n")[0]).toBe("screen    /tmp/shot.png  402×874 portrait");
});

test("no base64 ever reaches the rendered output", () => {
	const out = renderObservation(
		{
			screenshot: { mimeType: "image/jpeg", contentBase64: "AAAABBBBCCCC" },
			accessibility: iosTree,
		},
		"/tmp/shot.jpg",
	);
	expect(out).not.toContain("AAAABBBBCCCC");
});

test("a missing accessibility tree is stated, not silently empty", () => {
	expect(renderObservation({ accessibility: [] }, "/tmp/x.png")).toContain(
		"none (accessibility not captured)",
	);
});

test("the file name follows the mime type and is filesystem safe", () => {
	const at = new Date("2026-09-15T17:29:52.324Z");
	expect(observationFileName("android:emulator-5554", "image/jpeg", at)).toBe(
		"observe-android_emulator-5554-2026-09-15T17-29-52-324Z.jpg",
	);
	expect(observationFileName("d", undefined, at)).toEndWith(".png");
});

test("pruning keeps recent shots and drops the overflow", () => {
	const now = Date.UTC(2026, 8, 15, 12, 0, 0);
	const hour = 3600_000;
	const shots = Array.from({ length: 45 }, (_, i) => ({
		name: `observe-${i}.png`,
		modifiedMs: now - i * 60_000,
	}));
	const pruned = shotsToPrune(shots, now);
	expect(pruned).toHaveLength(5);
	expect(pruned).toContain("observe-44.png");
	expect(pruned).not.toContain("observe-0.png");

	const old = [
		{ name: "fresh.png", modifiedMs: now - hour },
		{ name: "stale.png", modifiedMs: now - 25 * hour },
	];
	expect(shotsToPrune(old, now)).toEqual(["stale.png"]);
});

test("an empty directory prunes nothing", () => {
	expect(shotsToPrune([], Date.now())).toEqual([]);
});
