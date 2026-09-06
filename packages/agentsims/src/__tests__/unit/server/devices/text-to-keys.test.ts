import { describe, expect, it } from "bun:test";
import {
	textToKeyEvents,
	UnsupportedCharacterError,
} from "../../../../server/devices/text-to-keys";

describe("textToKeyEvents", () => {
	it("emits down/up for a single lowercase letter", () => {
		expect(textToKeyEvents("a")).toEqual([
			{ type: "down", usage: 0x04 },
			{ type: "up", usage: 0x04 },
		]);
	});

	it("wraps shifted characters with left-shift down/up", () => {
		// 'A' = shift + KeyA(0x04)
		expect(textToKeyEvents("A")).toEqual([
			{ type: "down", usage: 0xe1 },
			{ type: "down", usage: 0x04 },
			{ type: "up", usage: 0x04 },
			{ type: "up", usage: 0xe1 },
		]);
	});

	it("maps digits and shifted symbols on the digits row", () => {
		// '1' = 0x1e (no shift); '!' = shift + 0x1e
		expect(textToKeyEvents("1!")).toEqual([
			{ type: "down", usage: 0x1e },
			{ type: "up", usage: 0x1e },
			{ type: "down", usage: 0xe1 },
			{ type: "down", usage: 0x1e },
			{ type: "up", usage: 0x1e },
			{ type: "up", usage: 0xe1 },
		]);
		// '0' = 0x27
		expect(textToKeyEvents("0")[0]).toEqual({ type: "down", usage: 0x27 });
	});

	it("maps space, newline, and tab to their HID codes", () => {
		expect(textToKeyEvents(" ")[0]).toEqual({ type: "down", usage: 0x2c });
		expect(textToKeyEvents("\n")[0]).toEqual({ type: "down", usage: 0x28 });
		expect(textToKeyEvents("\t")[0]).toEqual({ type: "down", usage: 0x2b });
	});

	it("normalizes CRLF to a single Enter press", () => {
		expect(textToKeyEvents("\r\n")).toEqual([
			{ type: "down", usage: 0x28 },
			{ type: "up", usage: 0x28 },
		]);
	});

	it("covers common punctuation in both plain and shifted forms", () => {
		// ; → 0x33, : → shift+0x33; / → 0x38, ? → shift+0x38
		expect(textToKeyEvents(";")[0]).toEqual({ type: "down", usage: 0x33 });
		expect(textToKeyEvents(":")[0]).toEqual({ type: "down", usage: 0xe1 });
		expect(textToKeyEvents("/")[0]).toEqual({ type: "down", usage: 0x38 });
		expect(textToKeyEvents("?")[1]).toEqual({ type: "down", usage: 0x38 });
	});

	it("throws UnsupportedCharacterError for non-US-keyboard chars", () => {
		expect(() => textToKeyEvents("é")).toThrow(UnsupportedCharacterError);
		expect(() => textToKeyEvents("emoji 🙂 here")).toThrow(
			UnsupportedCharacterError,
		);
	});

	it("produces 4 events for an uppercase letter (shift wraps key)", () => {
		expect(textToKeyEvents("A").length).toBe(4);
	});

	it("expands 'Hi!' to the expected event count", () => {
		// H: shift+down+up+shift(4) ; i: down+up(2) ; !: shift+down+up+shift(4) → 10
		expect(textToKeyEvents("Hi!").length).toBe(10);
	});
});
