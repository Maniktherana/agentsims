import { describe, expect, test } from "bun:test";
import {
	LatestGridRequest,
	reuseGridDevices,
} from "../../../../../web/hooks/workspace/use-grid-devices";
import type { GridDevice } from "../../../../../web/workspace/grid";

function gridDevice(device: string, state = "Booted"): GridDevice {
	return { device, name: device, runtime: "iOS-26-0", state, helper: null };
}

describe("reuseGridDevices", () => {
	test("an unchanged poll keeps the previous list, so the workspace does not render", () => {
		const previous = [gridDevice("one"), gridDevice("two")];
		const next = reuseGridDevices(previous, [
			gridDevice("one"),
			gridDevice("two"),
		]);
		expect(next).toBe(previous);
	});

	test("a changed device gets a new object and the others keep theirs", () => {
		const previous = [gridDevice("one"), gridDevice("two")];
		const next = reuseGridDevices(previous, [
			gridDevice("one"),
			gridDevice("two", "Shutdown"),
		]);
		expect(next).not.toBe(previous);
		expect(next[0]).toBe(previous[0]!);
		expect(next[1]).not.toBe(previous[1]!);
		expect(next[1]!.state).toBe("Shutdown");
	});

	test("a reordered poll returns the new order with the previous objects", () => {
		const previous = [gridDevice("one"), gridDevice("two")];
		const next = reuseGridDevices(previous, [
			gridDevice("two"),
			gridDevice("one"),
		]);
		expect(next.map((device) => device.device)).toEqual(["two", "one"]);
		expect(next[0]).toBe(previous[1]!);
	});
});

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
