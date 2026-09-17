import { describe, expect, it } from "bun:test";
import {
	editKeyEvents,
	textToKeyEvents,
	UnsupportedCharacterError,
	validateKeyboardText,
} from "../../../../core/ios/text-to-keys";

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

	it("maps space and tab to their HID codes", () => {
		expect(textToKeyEvents(" ")[0]).toEqual({ type: "down", usage: 0x2c });
		expect(textToKeyEvents("\t")[0]).toEqual({ type: "down", usage: 0x2b });
	});

	it("rejects newline data because Return is a separate action", () => {
		expect(() => textToKeyEvents("\n")).toThrow(UnsupportedCharacterError);
		expect(() => textToKeyEvents("\r")).toThrow(UnsupportedCharacterError);
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

	it("validates the complete input before event construction", () => {
		expect(() => validateKeyboardText("valid🙂")).toThrow(
			UnsupportedCharacterError,
		);
		expect(() => validateKeyboardText("valid\r\n")).toThrow(
			UnsupportedCharacterError,
		);
	});

});

describe("editKeyEvents", () => {
	it("sends Return only for the explicit enter action", () => {
		expect(editKeyEvents("enter")).toEqual([
			{ type: "down", usage: 0x28 },
			{ type: "up", usage: 0x28 },
		]);
	});

	it("deletes with backspace", () => {
		expect(editKeyEvents("delete")).toEqual([
			{ type: "down", usage: 0x2a },
			{ type: "up", usage: 0x2a },
		]);
	});

	it("selects all with the command chord no character can express", () => {
		expect(editKeyEvents("select-all")).toEqual([
			{ type: "down", usage: 0xe3 },
			{ type: "down", usage: 0x04 },
			{ type: "up", usage: 0x04 },
			{ type: "up", usage: 0xe3 },
		]);
	});
});
