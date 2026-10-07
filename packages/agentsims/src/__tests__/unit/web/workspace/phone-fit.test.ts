import { expect, test } from "bun:test";
import {
	fittedPhoneWidth,
	panelPhoneTranslation,
	workspaceCanvasHeight,
} from "../../../../web/workspace/phone-fit";

test("opening a panel constrains the displayed phone without replacing its preferred width", () => {
	const preferred = 400;
	expect(fittedPhoneWidth(preferred, 1000, 1000, 0.5)).toBe(400);
	expect(fittedPhoneWidth(preferred, 1000, 400, 0.5)).toBe(200);
	expect(fittedPhoneWidth(preferred, 1000, 1000, 0.5)).toBe(400);
});

test("panel placement correction keeps the stack visible and preserves the saved position", () => {
	const savedTop = 300;
	expect(panelPhoneTranslation(savedTop, 800, 1314, 366)).toBe(124 - savedTop);
	expect(savedTop).toBe(300);
	expect(panelPhoneTranslation(24, 800, 1314, 366)).toBe(0);
	expect(panelPhoneTranslation(-70, 500, 900, 366)).toBe(94);
	expect(panelPhoneTranslation(300, 1000, 900, 366)).toBe(-276);
	expect(panelPhoneTranslation(NaN, 500, 900, 366)).toBe(0);
});

test("width and height independently bound portrait and landscape phones", () => {
	expect(fittedPhoneWidth(900, 320, 700, 0.5)).toBe(320);
	expect(fittedPhoneWidth(900, 1000, 240, 2)).toBe(480);
	expect(fittedPhoneWidth(160, 1000, 1000, 0.5)).toBe(160);
});

test("fit geometry stays finite when viewport or preferences are invalid", () => {
	for (const invalid of [NaN, Infinity, -Infinity]) {
		expect(Number.isFinite(fittedPhoneWidth(invalid, 600, 800, 0.5))).toBe(
			true,
		);
		expect(fittedPhoneWidth(400, invalid, 800, 0.5)).toBe(1);
		expect(fittedPhoneWidth(400, 600, invalid, 0.5)).toBe(1);
	}
	expect(workspaceCanvasHeight(600, 700)).toBe(1);
	expect(workspaceCanvasHeight(600, 200)).toBe(314);
});
