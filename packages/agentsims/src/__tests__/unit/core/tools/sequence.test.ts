import { describe, expect, test } from "bun:test";
import {
	actionRequest,
	describeSequenceStep,
	MAX_SEQUENCE_STEPS,
	parseSequenceSteps,
	type SequenceInput,
} from "../../../../core/tools/sequence";

const tap = (target: string) => ({ type: "tap", target });

describe("parseSequenceSteps", () => {
	test("accepts a three-step file of label and percent targets", () => {
		const steps = parseSequenceSteps([
			{ type: "tap", target: "New Recipe", label: "open the form" },
			{ type: "type", text: "Pasta", into: "Title", submit: true },
			{ type: "swipe", from: "50%,80%", to: "50%,20%", durationMs: 300 },
		]);
		expect(steps).toHaveLength(3);
		expect(steps[0]).toEqual({
			type: "tap",
			target: "New Recipe",
			label: "open the form",
		});
		expect(steps[1]).toEqual({
			type: "type",
			text: "Pasta",
			into: "Title",
			submit: true,
		});
		expect(steps[2]?.type).toBe("swipe");
	});

	test("accepts every step type the sequence supports", () => {
		const steps = parseSequenceSteps([
			{ type: "tap", target: "Sign in", role: "button", index: 2 },
			{ type: "long-press", target: "Pasta", durationMs: 900 },
			{ type: "swipe", from: "Email", to: "Password" },
			{ type: "type", text: "a@b.co", into: "Email" },
			{ type: "fill", text: "12", into: "Servings" },
			{ type: "button", button: "back" },
			{ type: "wait", ms: 800 },
		]);
		expect(steps.map((step) => step.type)).toEqual([
			"tap",
			"long-press",
			"swipe",
			"type",
			"fill",
			"button",
			"wait",
		]);
	});

	test("rejects a ref target because refs die after the first mutation", () => {
		expect(() => parseSequenceSteps([tap("New Recipe"), tap("@e14")])).toThrow(
			"step 2 target: refs are not stable across steps; use labels",
		);
	});

	test("rejects a ref in every target field", () => {
		for (const step of [
			{ type: "swipe", from: "@e2", to: "50%,20%" },
			{ type: "swipe", from: "50%,80%", to: "@e2" },
			{ type: "type", text: "Pasta", into: "@e2" },
			{ type: "long-press", target: "@e2" },
		])
			expect(() => parseSequenceSteps([step])).toThrow(
				"refs are not stable across steps; use labels",
			);
	});

	test("rejects a pixel point and a capture ID the same way", () => {
		expect(() => parseSequenceSteps([tap("603,1311")])).toThrow(
			"pixel points need a capture ID, which is not stable across steps",
		);
		expect(() =>
			parseSequenceSteps([{ type: "tap", target: "50%,90%", capture: "c7" }]),
		).toThrow("capture IDs are not stable across steps");
	});

	test("keeps percent points, which need no capture", () => {
		expect(parseSequenceSteps([tap("50%,90%")])[0]).toEqual({
			type: "tap",
			target: "50%,90%",
		});
	});

	test(`rejects ${MAX_SEQUENCE_STEPS + 1} steps`, () => {
		const steps = Array.from({ length: MAX_SEQUENCE_STEPS + 1 }, () =>
			tap("Sign in"),
		);
		expect(steps).toHaveLength(26);
		expect(() => parseSequenceSteps(steps)).toThrow(
			`A sequence takes at most ${MAX_SEQUENCE_STEPS} steps`,
		);
		expect(
			parseSequenceSteps(steps.slice(0, MAX_SEQUENCE_STEPS)),
		).toHaveLength(MAX_SEQUENCE_STEPS);
	});

	test("rejects a wait longer than 10000 ms", () => {
		expect(() => parseSequenceSteps([{ type: "wait", ms: 10_001 }])).toThrow(
			"step 1 ms",
		);
		expect(parseSequenceSteps([{ type: "wait", ms: 10_000 }])[0]).toEqual({
			type: "wait",
			ms: 10_000,
		});
	});

	test("rejects an empty list, a non-list, and an unknown step type", () => {
		expect(() => parseSequenceSteps([])).toThrow(
			"A sequence needs at least one step",
		);
		expect(() => parseSequenceSteps({ steps: [] })).toThrow();
		expect(() => parseSequenceSteps([{ type: "scroll", target: "list" }])).toThrow();
	});

	test("rejects an unknown key so a typo never runs silently", () => {
		expect(() =>
			parseSequenceSteps([{ type: "tap", target: "Sign in", targets: "x" }]),
		).toThrow();
	});
});

describe("actionRequest", () => {
	test("drops the output label", () => {
		expect(
			actionRequest({
				type: "tap",
				target: "Sign in",
				label: "submit",
			} as SequenceInput),
		).toEqual({ type: "tap", target: "Sign in" });
	});

	test("turns fill into a clearing type, which is what /act accepts", () => {
		expect(
			actionRequest({
				type: "fill",
				text: "12",
				into: "Servings",
			} as SequenceInput),
		).toEqual({ type: "type", text: "12", into: "Servings", clear: true });
	});
});

describe("describeSequenceStep", () => {
	test("quotes labels and leaves points bare", () => {
		expect(describeSequenceStep({ type: "tap", target: "New Recipe" })).toBe(
			'tap "New Recipe"',
		);
		expect(describeSequenceStep({ type: "tap", target: "50%,90%" })).toBe(
			"tap 50%,90%",
		);
		expect(
			describeSequenceStep({ type: "swipe", from: "50%,80%", to: "50%,20%" }),
		).toBe("swipe 50%,80% to 50%,20%");
		expect(
			describeSequenceStep({ type: "type", text: "Pasta", into: "Title" }),
		).toBe('type "Pasta" into "Title"');
		expect(describeSequenceStep({ type: "button", button: "back" })).toBe(
			"press back",
		);
		expect(describeSequenceStep({ type: "wait", ms: 800 })).toBe("wait 800ms");
		expect(
			describeSequenceStep({
				type: "long-press",
				target: "Pasta",
				durationMs: 900,
			}),
		).toBe('long-press "Pasta" 900ms');
	});
});
