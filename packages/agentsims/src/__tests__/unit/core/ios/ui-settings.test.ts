import { describe, expect, test } from "bun:test";
import {
	CONTENT_SIZE_CATEGORIES,
	UI_OPTIONS,
	normalizeUiValue,
} from "../../../../core/ios/settings";

describe("iOS UI settings catalogue", () => {
	test("normalizes toggles and color aliases", () => {
		expect(normalizeUiValue("reduce-motion", "enabled")).toBe("on");
		expect(normalizeUiValue("reduce-motion", "no")).toBe("off");
		expect(normalizeUiValue("color-filter", "protanopia")).toBe("red-green");
		expect(normalizeUiValue("appearance", "blue")).toBeNull();
	});

	test("keeps the complete option catalogue", () => {
		expect(Object.keys(UI_OPTIONS)).toHaveLength(9);
		expect(CONTENT_SIZE_CATEGORIES).toHaveLength(12);
	});
});
