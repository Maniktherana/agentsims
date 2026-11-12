import { expect, test } from "bun:test";
import { CONTEXT_LIMITS } from "../../../../../core/tools/context/contracts";
import { parseContextInput } from "../../../../../core/tools/context/input";

function input(structure: unknown, deviceName?: unknown) {
	return {
		kind: "annotation",
		device: "ios-a",
		platform: "ios",
		sessionId: "session",
		capturedAt: 1,
		note: "",
		logs: [],
		image: { mimeType: "image/png", width: 1, height: 1, base64: "AA==" },
		...(deviceName === undefined ? {} : { deviceName }),
		target: {
			kind: "element",
			rect: { x: 0, y: 0, width: 1, height: 1 },
			revision: 1,
			collectedAt: 1,
			app: "app",
			orientation: "portrait",
			element: {
				id: "a",
				path: "0",
				label: "",
				value: "",
				role: "button",
				type: "Button",
				enabled: true,
				frame: { x: 0, y: 0, width: 1, height: 1 },
			},
			structure,
		},
	};
}

const row = { label: "Row", role: "cell" };

test("captured structure is accepted within its caps", () => {
	const parsed = parseContextInput(
		input(
			{
				ancestors: Array(CONTEXT_LIMITS.structureItems).fill(row),
				children: { total: 40, items: [row] },
				nearby: ["a", "b", "c"],
				instance: { index: 2, total: 3, basis: "source" },
			},
			"iPhone 17",
		),
	);
	expect(parsed.kind === "annotation" && parsed.deviceName).toBe("iPhone 17");
});

test("structure past its caps or with an impossible instance is rejected", () => {
	const over = Array(CONTEXT_LIMITS.structureItems + 1).fill(row);
	for (const structure of [
		{ ancestors: over },
		{ siblings: { total: 9, items: over } },
		{ children: { total: 1, items: [row, row] } },
		{ nearby: ["a", "b", "c", "d"] },
		{ ancestors: [{ role: "x".repeat(CONTEXT_LIMITS.structureText + 1) }] },
		{ instance: { index: 4, total: 3, basis: "source" } },
	])
		expect(() => parseContextInput(input(structure))).toThrow();
	expect(() => parseContextInput(input(undefined, "x".repeat(300)))).toThrow();
});
