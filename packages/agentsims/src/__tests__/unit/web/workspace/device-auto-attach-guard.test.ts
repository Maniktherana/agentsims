import { describe, expect, test } from "bun:test";
import { DeviceAutoAttachGuard } from "../../../../web/workspace/device-auto-attach-guard";

const IOS = "EA490A70-320C-4CE1-A8F9-55A7116CAFD9";

function device(state: string, helper: object | null = null) {
	return {
		device: IOS,
		state,
		helper: helper as {
			port: number;
			url: string;
			streamUrl: string;
			wsUrl: string;
		} | null,
	};
}

describe("device auto-attach lifecycle guard", () => {
	test("does not reattach stale Booted/no-helper catalog frames after shutdown", () => {
		const guard = new DeviceAutoAttachGuard();
		guard.beginShutdown(IOS);

		expect(
			guard.collectCandidates([device("Booted")], {}, { [IOS]: true }),
		).toEqual([]);
		// The shutdown POST can finish before the next grid response proves that
		// simctl has transitioned away from Booted.
		expect(
			guard.collectCandidates([device("Booted")], {}, { [IOS]: false }),
		).toEqual([]);
		expect(guard.isShutdownSuppressed(IOS)).toBe(true);

		expect(
			guard.collectCandidates([device("Shutdown")], {}, { [IOS]: false }),
		).toEqual([]);
		expect(guard.isShutdownSuppressed(IOS)).toBe(false);
	});

	test("preserves explicit Start and later auto-attach after shutdown is confirmed", () => {
		const guard = new DeviceAutoAttachGuard();
		guard.beginShutdown(IOS);
		expect(guard.collectCandidates([device("Shutdown")], {}, {})).toEqual([]);
		expect(guard.isShutdownSuppressed(IOS)).toBe(false);

		guard.beginExplicitStart(IOS);
		expect(guard.isShutdownSuppressed(IOS)).toBe(false);

		expect(guard.collectCandidates([device("Booted")], {}, {})).toEqual([IOS]);
		expect(guard.collectCandidates([device("Booted")], {}, {})).toEqual([]);
		guard.releaseAutoAttach(IOS);
		expect(guard.collectCandidates([device("Booted")], {}, {})).toEqual([IOS]);
	});

	test("does not treat omission from a paged catalog response as settled", () => {
		const guard = new DeviceAutoAttachGuard();
		guard.beginShutdown(IOS);
		expect(guard.collectCandidates([], {}, {})).toEqual([]);
		expect(guard.isShutdownSuppressed(IOS)).toBe(true);
	});

	test("resumes normal reconciliation when shutdown fails", () => {
		const guard = new DeviceAutoAttachGuard();
		guard.beginShutdown(IOS);
		guard.failShutdown(IOS);
		expect(guard.collectCandidates([device("Booted")], {}, {})).toEqual([IOS]);
	});
});
