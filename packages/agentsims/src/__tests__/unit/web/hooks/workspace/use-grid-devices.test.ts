import { describe, expect, test } from "bun:test";
import { LatestGridRequest } from "../../../../../web/hooks/workspace/use-grid-devices";

describe("LatestGridRequest", () => {
	test("rejects an older catalog completion after a newer request begins", () => {
		const requests = new LatestGridRequest();
		const older = requests.begin();
		const newer = requests.begin();

		expect(requests.isCurrent(older)).toBe(false);
		expect(requests.isCurrent(newer)).toBe(true);
	});

	test("invalidates pending completions when the polling effect stops", () => {
		const requests = new LatestGridRequest();
		const pending = requests.begin();
		requests.invalidate();

		expect(requests.isCurrent(pending)).toBe(false);
	});

});
