import { describe, expect, test } from "bun:test";
import type { AxSnapshot } from "../../../../../core/tools/observe/accessibility-model";
import { createSnapshotStore } from "../../../../../core/tools/observe/snapshot-store";
import {
	revalidateActionTargets,
	resolveActionTargets,
	resolveTarget,
	resolveTargetNode,
} from "../../../../../core/tools/observe/targets";
import { axElement } from "../../../../fixtures/ax-view-snapshots";

const DEVICE = "android:emulator-5554";
const OTHER_DEVICE = "ios:iphone";
const SCREEN = { width: 1080, height: 2400, orientation: "portrait" };

const screen: AxSnapshot = {
	screen: { width: 1080, height: 2400 },
	elements: [
		axElement("0", "android.widget.Button", {
			id: "search-button",
			label: "Search",
			testId: "com.example:id/search",
			frame: { x: 40, y: 200, width: 200, height: 100 },
		}),
		axElement("1", "android.widget.TextView", {
			id: "search-text",
			label: "Search results",
			frame: { x: 40, y: 400, width: 600, height: 80 },
		}),
		axElement("2", "android.widget.EditText", {
			id: "search-field",
			label: "Search",
			frame: { x: 40, y: 600, width: 600, height: 100 },
		}),
	],
};

function observed(snapshot: AxSnapshot = screen, device = DEVICE) {
	const store = createSnapshotStore();
	const observation = store.publishObservation(store.beginObservation(device), {
		platform: "android",
		snapshot,
		screen: SCREEN,
		app: "com.example.app",
		all: false,
	});
	if (!observation) throw new Error("Expected observation publication");
	return { store, refs: Object.keys(observation.refs) };
}

function publishCapture(
	store: ReturnType<typeof createSnapshotStore>,
	device = DEVICE,
	orientation = "portrait",
): string {
	const id = store.beginCapture(device);
	const published = store.publishCapture(id, {
		screen: { width: 1080, height: 2400 },
		orientation,
		generation: 4,
	});
	expect(published).not.toBeNull();
	return id;
}

describe("semantic targets", () => {
	test("a current ref resolves to an actionable node centre", () => {
		const { store, refs } = observed();
		const point = resolveTarget(store, DEVICE, { target: `@${refs[0]}` });
		expect(point).toMatchObject({
			ref: refs[0],
			role: "button",
			label: "Search",
			pixels: { x: 140, y: 250 },
		});
		expect(point.x).toBeCloseTo(140 / 1080, 5);
		expect(point.y).toBeCloseTo(250 / 2400, 5);
	});

	test("full and short test IDs resolve without fuzzy text recovery", () => {
		const { store, refs } = observed();
		expect(
			resolveTarget(store, DEVICE, { target: "com.example:id/search" }).ref,
		).toBe(refs[0]);
		expect(resolveTarget(store, DEVICE, { target: "search" }).ref).toBe(
			refs[0],
		);
		expect(() =>
			resolveTarget(store, DEVICE, { target: "Search res" }),
		).toThrow('no node matches "Search res"');
	});

	test("duplicate labels and duplicate test IDs are ambiguous", () => {
		const duplicateIds: AxSnapshot = {
			screen: screen.screen,
			elements: [
				axElement("0", "android.widget.Button", {
					id: "first",
					label: "First",
					testId: "shared",
				}),
				axElement("1", "android.widget.Button", {
					id: "second",
					label: "Second",
					testId: "shared",
				}),
			],
		};
		expect(() => resolveTarget(observed().store, DEVICE, { target: "Search" })).toThrow(
			'2 nodes match "Search"',
		);
		expect(() =>
			resolveTarget(observed(duplicateIds).store, DEVICE, { target: "shared" }),
		).toThrow('2 nodes match "shared"');
	});

	test("role and an uncapped positive index select explicitly", () => {
		const { store, refs } = observed();
		expect(
			resolveTarget(store, DEVICE, { target: "Search", role: "textbox" }).ref,
		).toBe(refs[2]);

		const many: AxSnapshot = {
			screen: screen.screen,
			elements: Array.from({ length: 1_001 }, (_, index) =>
				axElement(String(index), "android.widget.Button", {
					id: `row-${index + 1}`,
					label: "Row",
					frame: { x: 10, y: 10, width: 100, height: 40 },
				}),
			),
		};
		expect(
			resolveTargetNode(observed(many).store, DEVICE, {
				target: "Row",
				index: 1_001,
			}).id,
		).toBe("row-1001");
	});

	test("stale, wrong-device, and unknown refs fail closed", () => {
		const { store, refs } = observed();
		expect(() =>
			resolveTarget(store, OTHER_DEVICE, { target: `@${refs[0]}` }),
		).toThrow("belongs to another device");
		store.publishObservation(store.beginObservation(DEVICE), {
			platform: "android",
			snapshot: screen,
			screen: SCREEN,
			app: null,
			all: false,
		});
		expect(() =>
			resolveTarget(store, DEVICE, { target: `@${refs[0]}` }),
		).toThrow("is not addressable");
		expect(() => resolveTarget(store, DEVICE, { target: "@e999" })).toThrow(
			"is not addressable",
		);
	});
});

describe("actionability", () => {
	test.each([
		[
			"disabled",
			axElement("0", "android.widget.Button", {
				id: "target",
				label: "Target",
				enabled: false,
			}),
		],
		[
			"offscreen",
			axElement("0", "android.widget.Button", {
				id: "target",
				label: "Target",
				visibleToUser: false,
			}),
		],
		[
			"clipped",
			axElement("0", "android.widget.Button", {
				id: "target",
				label: "Target",
				frame: { x: 1_000, y: 20, width: 200, height: 40 },
			}),
		],
	] as const)("rejects a known %s target", (reason, element) => {
		const snapshot = { screen: screen.screen, elements: [element] };
		expect(() =>
			resolveTarget(observed(snapshot).store, DEVICE, { target: "Target" }),
		).toThrow(reason);
	});

	test("rejects a named node that is not actionable", () => {
		expect(() =>
			resolveTarget(observed().store, DEVICE, { target: "Search results" }),
		).toThrow("is not actionable");
	});

	test("keeps a clickable container actionable without redirecting its text child", () => {
		const item: AxSnapshot = {
			screen: screen.screen,
			elements: [
				axElement("0", "android.view.ViewGroup", {
					id: "item-root",
					testId: "item_root",
					traits: ["clickable"],
					frame: { x: 40, y: 200, width: 600, height: 100 },
				}),
				axElement("0.0", "android.widget.TextView", {
					id: "item-label",
					label: "task.html",
					frame: { x: 60, y: 220, width: 200, height: 60 },
				}),
			],
		};
		const { store } = observed(item);
		expect(resolveTarget(store, DEVICE, { target: "item_root" }).role).toBe(
			"generic",
		);
		expect(() =>
			resolveTarget(store, DEVICE, { target: "task.html" }),
		).toThrow('text "task.html"');
		expect(() =>
			resolveTarget(store, DEVICE, { target: "task.html" }),
		).toThrow("is not actionable");
	});

	test("allows a visible target in a higher non-focused popup", () => {
		const popup: AxSnapshot = {
			screen: screen.screen,
			elements: [
				axElement("0", "android.widget.FrameLayout", {
					id: "base-window",
					windowId: 262,
					windowLayer: 0,
					windowActive: true,
					windowFocused: true,
					frame: { x: 0, y: 0, width: 1080, height: 2400 },
				}),
				axElement("1", "android.widget.FrameLayout", {
					id: "popup-window",
					windowId: 263,
					windowLayer: 1,
					windowActive: false,
					windowFocused: false,
					frame: { x: 100, y: 500, width: 700, height: 500 },
				}),
				axElement("1.0", "android.widget.CheckedTextView", {
					id: "work",
					label: "Work",
					windowId: 263,
					sourceId: 77,
					traits: ["clickable", "checkable"],
					frame: { x: 120, y: 550, width: 640, height: 100 },
				}),
			],
		};
		expect(resolveTarget(observed(popup).store, DEVICE, { target: "Work" })).toMatchObject({
			label: "Work",
			pixels: { x: 440, y: 600 },
		});
	});

	test("rejects a lower target covered by a visible higher window", () => {
		const covered: AxSnapshot = {
			screen: screen.screen,
			elements: [
				axElement("0", "android.widget.FrameLayout", {
					id: "base-window",
					windowId: 262,
					windowLayer: 0,
					windowActive: true,
					windowFocused: true,
					frame: { x: 0, y: 0, width: 1080, height: 2400 },
				}),
				axElement("0.0", "android.widget.Button", {
					id: "covered",
					label: "Covered",
					frame: { x: 200, y: 600, width: 200, height: 100 },
				}),
				axElement("1", "android.widget.FrameLayout", {
					id: "popup-window",
					windowId: 263,
					windowLayer: 1,
					windowActive: false,
					windowFocused: false,
					frame: { x: 100, y: 500, width: 700, height: 500 },
				}),
			],
		};
		expect(() =>
			resolveTarget(observed(covered).store, DEVICE, { target: "Covered" }),
		).toThrow("behind the active window");
	});

	test("revalidates changed window ordering before dispatch", () => {
		const popup = (popupLayer: number): AxSnapshot => ({
			screen: screen.screen,
			elements: [
				axElement("0", "android.widget.FrameLayout", {
					id: "base-window",
					windowId: 262,
					windowLayer: 0,
					windowActive: true,
					windowFocused: true,
					frame: { x: 0, y: 0, width: 1080, height: 2400 },
				}),
				axElement("1", "android.widget.FrameLayout", {
					id: "popup-window",
					windowId: 263,
					windowLayer: popupLayer,
					frame: { x: 100, y: 500, width: 700, height: 500 },
				}),
				axElement("1.0", "android.widget.CheckedTextView", {
					id: "work",
					label: "Work",
					windowId: 263,
					sourceId: 77,
					traits: ["clickable", "checkable"],
					frame: { x: 120, y: 550, width: 640, height: 100 },
				}),
			],
		});
		const { store } = observed(popup(1));
		const action = resolveActionTargets(store, DEVICE, [
			{ type: "tap", target: "Work" },
		]);
		store.publishObservation(store.beginObservation(DEVICE), {
			platform: "android",
			snapshot: popup(-1),
			screen: SCREEN,
			app: "com.example.app",
			all: false,
		});
		expect(() => revalidateActionTargets(store, DEVICE, action)).toThrow(
			"behind the active window",
		);
	});

	test("rejects a target behind the active modal window", () => {
		const modal: AxSnapshot = {
			screen: screen.screen,
			elements: [
				axElement("0", "android.widget.FrameLayout", {
					id: "main-window",
					windowId: 10,
					windowLayer: 0,
					windowActive: false,
					frame: { x: 0, y: 0, width: 1080, height: 2400 },
				}),
				axElement("0.0", "android.widget.Button", {
					id: "behind",
					label: "Continue",
				}),
				axElement("1", "android.app.Dialog", {
					id: "dialog-window",
					windowId: 11,
					windowLayer: 5,
					windowActive: true,
					windowFocused: true,
					frame: { x: 100, y: 200, width: 880, height: 800 },
				}),
				axElement("1.0", "android.widget.Button", {
					id: "dismiss",
					label: "Dismiss",
				}),
			],
		};
		const { store } = observed(modal);
		expect(() =>
			resolveTarget(store, DEVICE, { target: "Continue" }),
		).toThrow("behind the active window");
		expect(resolveTarget(store, DEVICE, { target: "Dismiss" }).label).toBe(
			"Dismiss",
		);
	});
});

describe("capture-bound coordinates", () => {
	test("pixel and percent points use the capture dimensions", () => {
		const { store } = observed();
		const capture = publishCapture(store);
		expect(
			resolveTarget(
				store,
				DEVICE,
				{ target: "540,1200", capture },
				{ orientation: "portrait" },
			),
		).toMatchObject({
			x: 0.5,
			y: 0.5,
			pixels: { x: 540, y: 1200 },
			capture,
			orientation: "portrait",
		});
		expect(
			resolveTarget(
				store,
				DEVICE,
				{ target: "25%,75%", capture },
				{ orientation: "portrait" },
			),
		).toMatchObject({ x: 0.25, y: 0.75, pixels: { x: 270, y: 1800 } });
	});

	test("bare points and raw normalized coordinate actions are refused", () => {
		const { store } = observed();
		expect(() =>
			resolveTarget(store, DEVICE, { target: "50%,50%" }, { orientation: "portrait" }),
		).toThrow("requires a current capture ID");
		expect(() =>
			resolveActionTargets(store, DEVICE, [{ type: "tap", x: 0.5, y: 0.5 }]),
		).toThrow("bare coordinates are not accepted");
	});

	test("wrong-device and rotated captures are refused", () => {
		const { store } = observed();
		const capture = publishCapture(store);
		expect(() =>
			resolveTarget(
				store,
				OTHER_DEVICE,
				{ target: "10,20", capture },
				{ orientation: "portrait" },
			),
		).toThrow("belongs to another device");
		expect(() =>
			resolveTarget(
				store,
				DEVICE,
				{ target: "10,20", capture },
				{ orientation: "landscape_left" },
			),
		).toThrow("the device is now landscape_left");
		expect(() =>
			resolveTarget(
				store,
				DEVICE,
				{ target: "10,20", capture },
				{ orientation: "portrait", generation: 5 },
			),
		).toThrow("screen generation 4");
	});

	test("mutation, replacement, and incomplete captures fail closed", () => {
		const pendingStore = observed().store;
		const pending = pendingStore.beginCapture(DEVICE);
		expect(() =>
			resolveTarget(
				pendingStore,
				DEVICE,
				{ target: "10,20", capture: pending },
				{ orientation: "portrait" },
			),
		).toThrow("is not published");

		const failedStore = observed().store;
		const failed = failedStore.beginCapture(DEVICE);
		failedStore.failCapture(failed);
		expect(() =>
			resolveTarget(
				failedStore,
				DEVICE,
				{ target: "10,20", capture: failed },
				{ orientation: "portrait" },
			),
		).toThrow("failed and cannot be targeted");

		const staleStore = observed().store;
		const stale = publishCapture(staleStore);
		publishCapture(staleStore);
		expect(() =>
			resolveTarget(
				staleStore,
				DEVICE,
				{ target: "10,20", capture: stale },
				{ orientation: "portrait" },
			),
		).toThrow("does not exist");

		const mutatedStore = observed().store;
		const mutated = publishCapture(mutatedStore);
		mutatedStore.mutate(DEVICE);
		expect(() =>
			resolveTarget(
				mutatedStore,
				DEVICE,
				{ target: "10,20", capture: mutated },
				{ orientation: "portrait" },
			),
		).toThrow("does not exist");
	});
});

describe("action resolution", () => {
	test("resolves semantic actions without raw passthrough", () => {
		const { store, refs } = observed();
		const request = resolveActionTargets(store, DEVICE, [
			{ type: "tap", target: `@${refs[0]}` },
			{ type: "button", button: "home", ignored: true },
		]);
		expect(request.actions).toEqual([
			{ type: "tap", x: 140 / 1080, y: 250 / 2400 },
			{ type: "button", button: "home" },
		]);
	});

	test("resolves one capture-bound swipe", () => {
		const { store } = observed();
		const capture = publishCapture(store);
		const request = resolveActionTargets(
			store,
			DEVICE,
			[
				{
					type: "swipe",
					from: "50%,80%",
					to: "50%,20%",
					capture,
					durationMs: 300,
				},
			],
			{ orientation: "portrait" },
		);
		expect(request.actions).toEqual([
			{ type: "swipe", x1: 0.5, y1: 0.8, x2: 0.5, y2: 0.2, durationMs: 300 },
		]);
	});

	test("does not allow a capture to drive multiple actions", () => {
		const { store } = observed();
		const capture = publishCapture(store);
		expect(() =>
			resolveActionTargets(
				store,
				DEVICE,
				[
					{ type: "tap", target: "10,20", capture },
					{ type: "button", button: "home" },
				],
				{ orientation: "portrait" },
			),
		).toThrow("must be the only action");
	});
});
