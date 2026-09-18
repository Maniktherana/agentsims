// Convert a US-keyboard text string into a sequence of USB HID Usage Page 0x07
// keyboard events (`down`/`up`) suitable for the agentsims WS key opcode (0x06).
//
// Supports characters that a US hardware keyboard can insert without using a
// control key whose meaning depends on the focused field.

const LEFT_SHIFT = 0xe1;

// Char → { usage, shift } for US keyboard physical keys.
type KeySpec = { usage: number; shift: boolean };

function buildMap(): Record<string, KeySpec> {
	const map: Record<string, KeySpec> = {};

	for (let i = 0; i < 26; i++) {
		const usage = 0x04 + i;
		map[String.fromCharCode(0x61 + i)] = { usage, shift: false }; // a-z
		map[String.fromCharCode(0x41 + i)] = { usage, shift: true }; // A-Z
	}

	// Digits row: 1..9 then 0
	const digits = "1234567890";
	const digitShifted = "!@#$%^&*()";
	for (let i = 0; i < 10; i++) {
		const usage = 0x1e + i;
		map[digits[i]!] = { usage, shift: false };
		map[digitShifted[i]!] = { usage, shift: true };
	}

	const rest: Array<[string, string, number]> = [
		// [plain, shifted, usage]
		["-", "_", 0x2d],
		["=", "+", 0x2e],
		["[", "{", 0x2f],
		["]", "}", 0x30],
		["\\", "|", 0x31],
		[";", ":", 0x33],
		["'", '"', 0x34],
		["`", "~", 0x35],
		[",", "<", 0x36],
		[".", ">", 0x37],
		["/", "?", 0x38],
	];
	for (const [plain, shifted, usage] of rest) {
		map[plain] = { usage, shift: false };
		map[shifted] = { usage, shift: true };
	}

	map[" "] = { usage: 0x2c, shift: false };
	map["\t"] = { usage: 0x2b, shift: false }; // Tab

	return map;
}

export const US_KEYBOARD_MAP: Readonly<Record<string, KeySpec>> = buildMap();

export type KeyEvent = { type: "down" | "up"; usage: number };

const LEFT_GUI = 0xe3;
const RETURN = 0x28;
const BACKSPACE = 0x2a;
const LETTER_A = 0x04;

/** Keys that edit a field. A character string cannot express them. */
export const EDIT_KEYS = ["enter", "select-all", "delete"] as const;
export type EditKey = (typeof EDIT_KEYS)[number];

export function editKeyEvents(key: EditKey): KeyEvent[] {
	if (key === "enter")
		return [
			{ type: "down", usage: RETURN },
			{ type: "up", usage: RETURN },
		];
	if (key === "delete")
		return [
			{ type: "down", usage: BACKSPACE },
			{ type: "up", usage: BACKSPACE },
		];
	return [
		{ type: "down", usage: LEFT_GUI },
		{ type: "down", usage: LETTER_A },
		{ type: "up", usage: LETTER_A },
		{ type: "up", usage: LEFT_GUI },
	];
}

export class UnsupportedCharacterError extends Error {
	constructor(public readonly char: string) {
		super(`Unsupported character: ${JSON.stringify(char)}`);
	}
}

/** Reject the whole input before focus or key dispatch changes the device. */
export function validateKeyboardText(text: string): void {
	for (const char of text)
		if (!US_KEYBOARD_MAP[char]) throw new UnsupportedCharacterError(char);
}

/** Returns the events needed to type `text`, or throws on unsupported chars.
 *  Each character emits (optional shift down) → key down → key up → (optional shift up). */
export function textToKeyEvents(text: string): KeyEvent[] {
	validateKeyboardText(text);
	const events: KeyEvent[] = [];
	for (const ch of text) {
		const spec = US_KEYBOARD_MAP[ch]!;
		if (spec.shift) events.push({ type: "down", usage: LEFT_SHIFT });
		events.push({ type: "down", usage: spec.usage });
		events.push({ type: "up", usage: spec.usage });
		if (spec.shift) events.push({ type: "up", usage: LEFT_SHIFT });
	}
	return events;
}
