import { expect, test } from "bun:test";
import {
	AndroidToolActionSchema,
	type AndroidToolAction,
} from "../../../../core/android/contracts";

const decodeAction = AndroidToolActionSchema.parse;
test("Android action validation preserves optional fields and strips excess input", () => {
	const action: AndroidToolAction = decodeAction({
		type: "settings",
		showTouches: false,
		fontScale: 1,
		unused: "ignored",
	});
	expect(action).toEqual({
		type: "settings",
		showTouches: false,
		fontScale: 1,
	});
	expect(decodeAction({ type: "battery", level: 0, charging: false })).toEqual({
		type: "battery",
		level: 0,
		charging: false,
	});
	for (const invalid of [
		{ type: "battery", level: "10" },
		{ type: "snapshot", operation: "load" },
		{ type: "unknown" },
		{ type: "location", latitude: Number.NaN, longitude: 0 },
	])
		expect(() => decodeAction(invalid)).toThrow();
});
