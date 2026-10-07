import { expect, test } from "bun:test";
import {
	clampIntegratedToolPanelHeight,
	integratedToolPanelHeightBounds,
	integratedToolPanelHeightForKey,
	integratedToolPanelPointerHeight,
	shouldCloseIntegratedToolPanelOnPointerRelease,
} from "../../../../web/workspace/integrated-tool-panel-height";

test("the panel respects workspace room, including room below its preferred minimum", () => {
	expect(integratedToolPanelHeightBounds()).toEqual({ min: 180, max: 640 });
	expect(clampIntegratedToolPanelHeight(900, 180, 420)).toBe(420);
	expect(clampIntegratedToolPanelHeight(40, 180, 420)).toBe(180);
	expect(integratedToolPanelHeightBounds(180, 120)).toEqual({ min: 120, max: 120 });
	expect(clampIntegratedToolPanelHeight(280, 180, 120)).toBe(120);
	expect(clampIntegratedToolPanelHeight(280, 180, 0)).toBe(0);
});

test("malformed or fractional geometry cannot leave the bounded pixel range", () => {
	expect(integratedToolPanelHeightBounds(Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ min: 180, max: 640 });
	expect(clampIntegratedToolPanelHeight(Number.NaN)).toBe(280);
	expect(integratedToolPanelHeightBounds(-10, -20)).toEqual({ min: 0, max: 0 });
	expect(integratedToolPanelHeightBounds(180.2, 420.9)).toEqual({ min: 181, max: 420 });
	expect(clampIntegratedToolPanelHeight(420.8, 180.2, 420.9)).toBe(420);
	expect(clampIntegratedToolPanelHeight(180.2, 180.2, 420.9)).toBe(181);
});

test("dragging the top edge up grows the panel and uses the drag origin without accumulated drift", () => {
	expect(integratedToolPanelPointerHeight(280, 500, 450)).toBe(330);
	expect(integratedToolPanelPointerHeight(280, 500, 400)).toBe(380);
	expect(integratedToolPanelPointerHeight(280, 500, 520)).toBe(260);
	expect(integratedToolPanelPointerHeight(280, 500, -1000, 180, 420)).toBe(420);
	expect(integratedToolPanelPointerHeight(280, 500, 1000)).toBe(180);
	expect(integratedToolPanelPointerHeight(280, Number.NaN, 100)).toBe(280);
});

test("keyboard resizing grows upward, supports coarse changes, and stays bounded", () => {
	expect(integratedToolPanelHeightForKey(280, "ArrowUp", false)).toBe(288);
	expect(integratedToolPanelHeightForKey(280, "ArrowDown", false)).toBe(272);
	expect(integratedToolPanelHeightForKey(280, "ArrowUp", true)).toBe(312);
	expect(integratedToolPanelHeightForKey(280, "ArrowDown", true)).toBe(248);
	expect(integratedToolPanelHeightForKey(638, "ArrowUp", true)).toBe(640);
	expect(integratedToolPanelHeightForKey(181, "ArrowDown", false)).toBe(180);
	expect(integratedToolPanelHeightForKey(280, "Home", false, 180, 420)).toBe(180);
	expect(integratedToolPanelHeightForKey(280, "End", true, 180, 420)).toBe(420);
	expect(integratedToolPanelHeightForKey(280, "Enter", false)).toBeNull();
	expect(integratedToolPanelHeightForKey(280, "ArrowLeft", false)).toBeNull();
});

test("resizing adapts to changing workspace bounds without losing the drag origin", () => {
	const startHeight = 280;
	const startY = 500;
	expect(integratedToolPanelPointerHeight(startHeight, startY, 100, 180, 420)).toBe(420);
	expect(integratedToolPanelPointerHeight(startHeight, startY, 450, 180, 420)).toBe(330);
	expect(integratedToolPanelPointerHeight(startHeight, startY, 450, 180, 120)).toBe(120);
	expect(integratedToolPanelPointerHeight(startHeight, startY, 450, 180, 420)).toBe(330);
	expect(integratedToolPanelHeightForKey(420, "ArrowUp", true, 180, 120)).toBe(120);
	expect(integratedToolPanelHeightForKey(120, "Home", false, 180, 0)).toBe(0);
	expect(integratedToolPanelHeightForKey(120, "End", false, 180, 0)).toBe(0);
});

test("fractional and invalid pointer coordinates produce finite whole-pixel heights", () => {
	expect(integratedToolPanelPointerHeight(280, 500.5, 450.2)).toBe(330);
	expect(integratedToolPanelPointerHeight(280, 500, Number.NaN)).toBe(280);
	expect(integratedToolPanelPointerHeight(280, Number.POSITIVE_INFINITY, 450)).toBe(280);
	expect(integratedToolPanelPointerHeight(280, 500, Number.NEGATIVE_INFINITY)).toBe(280);
	expect(integratedToolPanelPointerHeight(Number.NaN, 500, 450)).toBe(280);
});

test("release can close below the normal resize minimum without collapsing visible resize bounds", () => {
	expect(integratedToolPanelPointerHeight(280, 500, 732)).toBe(180);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 731, 1000)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 732, 1000)).toBe(true);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 800, 1000)).toBe(true);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 600, 1000)).toBe(false);
	// A drag that returns from an overshoot uses its release position.
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 450, 1000)).toBe(false);
});

test("release within the bottom edge closes even when an offset gesture requests more than 48 pixels", () => {
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(320, 720, 975, 1000)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(320, 720, 976, 1000)).toBe(true);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(320, 720, 1000, 1000)).toBe(true);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(320, 720, 1010, 1000)).toBe(true);
});

test("invalid release geometry cannot close the panel", () => {
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(Number.NaN, 500, 732, 1000)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, Number.POSITIVE_INFINITY, 732, 1000)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, Number.NaN, 1000)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 732, Number.NaN)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 732, 0)).toBe(false);
	expect(shouldCloseIntegratedToolPanelOnPointerRelease(280, 500, 732, -100)).toBe(false);
});
