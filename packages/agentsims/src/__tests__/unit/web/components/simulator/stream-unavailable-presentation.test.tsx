import { describe, expect, test } from "bun:test";
import { streamSurfaceState } from "../../../../../web/components/simulator/simulator-view";

describe("unavailable stream presentation", () => {
	test("dims a retained frame but uses the placeholder before any frame", () => {
		expect(streamSurfaceState(false, true)).toBe("retained-frame");
		expect(streamSurfaceState(false, false)).toBe("placeholder");
		expect(streamSurfaceState(true, true)).toBe("live");
	});
});
