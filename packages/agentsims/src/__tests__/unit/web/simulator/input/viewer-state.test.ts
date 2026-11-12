import { describe, expect, test } from "bun:test";
import { nextViewerState } from "../../../../../web/simulator/input/exec";

describe("viewer state broadcast", () => {
	test("a repeated holder broadcast keeps the same state, so no device renders", () => {
		const current = { viewer: "v1", holders: { "ios-one": "v1" } };
		expect(nextViewerState(current, { holders: { "ios-one": "v1" } })).toBe(
			current,
		);
		expect(nextViewerState(current, { viewer: "v1" })).toBe(current);
	});

	test("a changed holder gives a new state", () => {
		const current = { viewer: "v1", holders: { "ios-one": "v1" } };
		const next = nextViewerState(current, { holders: { "ios-one": "v2" } });
		expect(next).not.toBe(current);
		expect(next.holders["ios-one"]).toBe("v2");
	});
});
