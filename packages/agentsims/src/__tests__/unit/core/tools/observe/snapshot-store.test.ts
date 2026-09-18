import { describe, expect, test } from "bun:test";
import type { AxSnapshot } from "../../../../../core/tools/observe/accessibility-model";
import { createSnapshotStore } from "../../../../../core/tools/observe/snapshot-store";
import {
	androidSignInSnapshot,
	axElement,
} from "../../../../fixtures/ax-view-snapshots";

const DEVICE = "android:emulator-5554";
const OTHER_DEVICE = "ios:iphone";

function record(
	store: ReturnType<typeof createSnapshotStore>,
	snapshot: AxSnapshot,
	device = DEVICE,
) {
	const ticket = store.beginObservation(device);
	const result = store.publishObservation(ticket, {
		platform: "android",
		snapshot,
		screen: { width: 1080, height: 2400, orientation: "portrait" },
		app: "com.example.app",
		all: false,
	});
	if (!result) throw new Error("Expected observation publication");
	return result;
}

function firstRef(snapshot: ReturnType<typeof record>): string {
	return Object.keys(snapshot.refs)[0]!;
}

const twoButtons: AxSnapshot = {
	screen: { width: 1080, height: 2400 },
	elements: [
		axElement("0", "android.widget.Button", { id: "a", label: "A" }),
		axElement("1", "android.widget.Button", { id: "b", label: "B" }),
	],
};

describe("snapshot store provenance", () => {
	test("observations count independently but refs cannot cross devices", () => {
		const store = createSnapshotStore();
		const android = record(store, twoButtons);
		const ios = record(store, twoButtons, OTHER_DEVICE);
		expect(Object.keys(android.refs)).toHaveLength(2);
		expect(Object.keys(ios.refs)).toHaveLength(2);
		expect(store.resolveRef(DEVICE, firstRef(android)).ok).toBe(true);
		expect(store.resolveRef(OTHER_DEVICE, firstRef(android))).toMatchObject({
			ok: false,
			reason: "wrong_device",
		});
	});

	test("refs do not repeat and an older observation fails closed", () => {
		const store = createSnapshotStore();
		const first = record(store, twoButtons);
		const second = record(store, twoButtons);
		const firstId = firstRef(first);
		const secondId = firstRef(second);
		expect(firstId).not.toBe(secondId);
		expect(store.resolveRef(DEVICE, firstId).ok).toBe(false);
		expect(store.resolveRef(DEVICE, `@${secondId}`)).toMatchObject({
			ok: true,
			node: { label: "A" },
		});
	});

	test("session replacement invalidates refs without reusing them", () => {
		const store = createSnapshotStore();
		const oldRef = firstRef(record(store, twoButtons));
		store.invalidate(DEVICE);
		expect(store.current(DEVICE)).toBeNull();
		expect(store.resolveRef(DEVICE, oldRef).ok).toBe(false);
		const newRef = firstRef(record(store, twoButtons));
		expect(oldRef).not.toBe(newRef);
	});

	test("a mutation invalidates the current tree and its refs", () => {
		const store = createSnapshotStore();
		const ref = firstRef(record(store, twoButtons));
		store.mutate(DEVICE);
		expect(store.current(DEVICE)).toBeNull();
		expect(store.normalized(DEVICE)).toBeNull();
		expect(store.resolveRef(DEVICE, ref).ok).toBe(false);
	});

	test("the complete normalized tree is separate from presented refs", () => {
		const store = createSnapshotStore();
		const raw: AxSnapshot = {
			screen: { width: 1080, height: 2400 },
			elements: [
				axElement("0", "android.view.View", { id: "root" }),
				axElement("0.0", "android.view.View", { id: "structure" }),
				axElement("0.0.0", "android.widget.Button", {
					id: "button",
					label: "Continue",
				}),
			],
		};
		const observation = record(store, raw);
		expect(store.normalized(DEVICE)).toBe(raw);
		expect(store.normalized(DEVICE)?.elements).toHaveLength(3);
		expect(observation.shown).toBe(1);
		expect(Object.values(observation.refs)).toEqual(["button"]);
	});

	test("the ref map points at platform element ids", () => {
		const store = createSnapshotStore();
		const observation = record(store, androidSignInSnapshot);
		expect(Object.values(observation.refs)).toContain("com.example:id/submit");
		expect(store.current(DEVICE)).toBe(observation);
		expect(observation.app).toBe("com.example.app");
	});
});

describe("capture provenance", () => {
	test("pending and failed captures are never resolvable", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const pending = store.beginCapture(DEVICE);
		expect(store.resolveCapture(DEVICE, pending)).toMatchObject({
			ok: false,
			reason: "unpublished",
		});
		expect(store.failCapture(pending)).toBe(true);
		expect(store.resolveCapture(DEVICE, pending)).toMatchObject({
			ok: false,
			reason: "failed",
		});
	});

	test("a published capture is bound to its device and observation", () => {
		const store = createSnapshotStore();
		const observation = record(store, twoButtons);
		const id = store.beginCapture(DEVICE);
		const capture = store.publishCapture(id, {
			screen: { width: 1080, height: 2400 },
			orientation: "portrait",
			observation: observation.id,
		});
		expect(capture).toMatchObject({
			id,
			device: DEVICE,
			observation: "s1",
			orientation: "portrait",
		});
		expect(store.resolveCapture(DEVICE, id)).toMatchObject({ ok: true });
		expect(store.resolveCapture(OTHER_DEVICE, id)).toMatchObject({
			ok: false,
			reason: "wrong_device",
		});
	});

	test("an explicit null observation keeps a capture unbound", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const id = store.beginCapture(DEVICE);
		const capture = store.publishCapture(id, {
			screen: { width: 1080, height: 2400 },
			observation: null,
		});

		expect(capture).toMatchObject({ id, observation: null });
	});

	test("captures are unique and stay current until the screen changes", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const first = store.beginCapture(DEVICE);
		store.publishCapture(first, { screen: { width: 1080, height: 2400 } });
		const second = store.beginCapture(DEVICE);
		store.publishCapture(second, { screen: { width: 1080, height: 2400 } });
		expect(first).not.toBe(second);
		expect(store.resolveCapture(DEVICE, first)).toMatchObject({ ok: true });
		expect(store.resolveCapture(DEVICE, second)).toMatchObject({ ok: true });
		store.mutate(DEVICE);
		expect(store.resolveCapture(DEVICE, first)).toMatchObject({
			ok: false,
			reason: "stale",
		});
		expect(store.resolveCapture(DEVICE, second)).toMatchObject({
			ok: false,
			reason: "stale",
		});
		expect(store.resolveCapture(DEVICE, "c999")).toMatchObject({
			ok: false,
			reason: "unknown",
		});
	});

	test("capture history keeps sixteen ids and evicts the oldest", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const ids: string[] = [];
		for (let index = 0; index < 17; index += 1) {
			const id = store.beginCapture(DEVICE);
			store.publishCapture(id, { screen: { width: 1080, height: 2400 } });
			ids.push(id);
		}
		expect(store.resolveCapture(DEVICE, ids[0]!)).toMatchObject({
			ok: false,
			reason: "unknown",
		});
		expect(store.resolveCapture(DEVICE, ids[1]!)).toMatchObject({ ok: true });
		expect(store.resolveCapture(DEVICE, ids[16]!)).toMatchObject({ ok: true });
	});

	test("a later observation keeps an older capture until input changes the screen", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const capture = store.beginCapture(DEVICE);
		store.publishCapture(capture, { screen: { width: 1080, height: 2400 } });
		record(store, twoButtons);
		expect(store.resolveCapture(DEVICE, capture)).toMatchObject({ ok: true });
		store.mutate(DEVICE);
		expect(store.resolveCapture(DEVICE, capture)).toMatchObject({
			ok: false,
			reason: "stale",
		});
	});

	test("a retired capture can never target input", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const capture = store.beginCapture(DEVICE);
		store.publishCapture(capture, { screen: { width: 1080, height: 2400 } });
		expect(store.retireCapture(capture)).toBe(true);
		expect(store.resolveCapture(DEVICE, capture)).toMatchObject({
			ok: false,
			reason: "retired",
		});
	});

	test("mutation and session replacement make captures stale", () => {
		const store = createSnapshotStore();
		record(store, twoButtons);
		const mutationCapture = store.beginCapture(DEVICE);
		store.publishCapture(mutationCapture, {
			screen: { width: 1080, height: 2400 },
		});
		store.mutate(DEVICE);
		expect(store.resolveCapture(DEVICE, mutationCapture)).toMatchObject({
			ok: false,
			reason: "stale",
		});
		record(store, twoButtons);
		const sessionCapture = store.beginCapture(DEVICE);
		store.publishCapture(sessionCapture, {
			screen: { width: 1080, height: 2400 },
		});
		store.invalidate(DEVICE);
		expect(store.resolveCapture(DEVICE, sessionCapture)).toMatchObject({
			ok: false,
			reason: "stale",
		});
	});

	test("a mutation prevents an in-flight observation from publishing", () => {
		const store = createSnapshotStore();
		const ticket = store.beginObservation(DEVICE);
		store.mutate(DEVICE);
		expect(
			store.publishObservation(ticket, {
				platform: "android",
				snapshot: twoButtons,
				screen: { width: 1080, height: 2400, orientation: "portrait" },
				app: null,
				all: false,
			}),
		).toBeNull();
		expect(store.current(DEVICE)).toBeNull();
	});

	test("only the newest overlapping observation can publish", () => {
		const store = createSnapshotStore();
		const first = store.beginObservation(DEVICE);
		const second = store.beginObservation(DEVICE);
		const input = {
			platform: "android" as const,
			snapshot: twoButtons,
			screen: { width: 1080, height: 2400, orientation: "portrait" },
			app: null,
			all: false,
		};
		expect(store.publishObservation(first, input)).toBeNull();
		expect(store.publishObservation(second, input)).not.toBeNull();
	});
});
