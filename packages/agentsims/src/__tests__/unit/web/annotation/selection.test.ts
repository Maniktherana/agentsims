import { describe, expect, test } from "bun:test";
import type {
	AxElement,
	AxSnapshot,
} from "../../../../core/tools/observe/accessibility-model";
import type {
	AnnotationCacheMetadata,
	AnnotationIdentity,
	AnnotationSelectionInput,
} from "../../../../web/annotation/contracts";
import {
	annotationCacheFailure,
	cycleAnnotationParent,
	prepareAnnotationCache,
	selectAnnotationAtPoint,
	validateAnnotationSelection,
} from "../../../../web/annotation/selection";

const identity: AnnotationIdentity = {
	device: "ios-1",
	sessionId: "session-1",
	platform: "ios",
	app: "com.example.app",
	orientation: "portrait",
};
const metadata: AnnotationCacheMetadata = {
	...identity,
	revision: 1,
	collectedAt: 1000,
	connected: true,
	dirty: false,
	confirmedUnchanged: false,
};
const geometry = {
	viewport: { x: 100, y: 50, width: 300, height: 600 },
	image: { width: 900, height: 1800 },
	axScreen: { width: 300, height: 600 },
};
const node = (
	path: string,
	frame: AxElement["frame"],
	extra: Partial<AxElement> = {},
): AxElement => ({
	id: `node-${path}`,
	path,
	label: "Target",
	value: "",
	role: "button",
	type: "Button",
	enabled: true,
	frame,
	...extra,
});
const root = () =>
	node(
		"0",
		{ x: 0, y: 0, width: 300, height: 600 },
		{ role: "ViewGroup", type: "ViewGroup", label: "" },
	);
const target = () => node("0.0", { x: 20, y: 40, width: 80, height: 50 });
const snapshot = (elements = [root(), target()]): AxSnapshot => ({
	screen: { width: 300, height: 600 },
	elements,
});
const input = (
	overrides: Partial<AnnotationSelectionInput> = {},
): AnnotationSelectionInput => ({
	identity,
	cache: prepareAnnotationCache(metadata, snapshot()),
	geometry,
	point: { x: 140, y: 110 },
	now: 1500,
	...overrides,
});

describe("one local annotation target", () => {
	test("chooses the smallest meaningful hit before label preference", () => {
		const small = node(
			"0.1",
			{ x: 30, y: 50, width: 20, height: 20 },
			{ label: "" },
		);
		const result = selectAnnotationAtPoint(
			input({
				cache: prepareAnnotationCache(
					metadata,
					snapshot([root(), target(), small]),
				),
			}),
		);
		expect(result?.kind === "element" && result.element.path).toBe("0.1");
	});
	test("copies image and viewport evidence bounds", () => {
		const result = selectAnnotationAtPoint(input());
		expect(result?.kind === "element" && result.imageRect).toEqual({
			x: 60,
			y: 120,
			width: 240,
			height: 150,
		});
		expect(result?.kind === "element" && result.viewportRect).toEqual({
			x: 120,
			y: 90,
			width: 80,
			height: 50,
		});
	});
	test("breaks ties independent of AX array order", () => {
		const a = node("0.1", target().frame, { id: "alpha" });
		const b = node("0.2", target().frame, { id: "beta" });
		for (const nodes of [
			[root(), a, b],
			[b, root(), a],
		]) {
			const result = selectAnnotationAtPoint(
				input({ cache: prepareAnnotationCache(metadata, snapshot(nodes)) }),
			);
			expect(result?.kind === "element" && result.key).toBe("alpha@0.1");
		}
	});
	test("chooses nested bounds and cycles captured parents", () => {
		const parent = target(),
			child = node("0.0.0", parent.frame);
		const result = selectAnnotationAtPoint(
			input({
				cache: prepareAnnotationCache(
					metadata,
					snapshot([root(), parent, child]),
				),
			}),
		);
		if (result?.kind !== "element") throw new Error("Expected an element");
		expect(result.element.path).toBe("0.0.0");
		const next = cycleAnnotationParent(result);
		expect(next.element.path).toBe("0.0");
		expect(cycleAnnotationParent(next).element.path).toBe("0");
		expect(
			cycleAnnotationParent(cycleAnnotationParent(next)).element.path,
		).toBe("0.0.0");
	});
	test("ignores hidden descendants and propagated decorative source owners", () => {
		const hidden = node("0.1", target().frame, { visibleToUser: false });
		const child = node("0.1.0", target().frame);
		const decoration = node(
			"0.2",
			{ x: 30, y: 50, width: 10, height: 10 },
			{
				role: "image",
				type: "Image",
				label: "",
				source: {
					kind: "react-native",
					confidence: "related-native-id",
					testID: "owner",
					componentName: "Pressable",
					elementName: "Pressable",
					matchReason: "ancestor-owner",
				},
			},
		);
		const result = selectAnnotationAtPoint(
			input({
				cache: prepareAnnotationCache(
					metadata,
					snapshot([root(), target(), hidden, child, decoration]),
				),
			}),
		);
		expect(result?.kind === "element" && result.element.path).toBe("0.0");
	});
	test("clips to the visible ancestor instead of selecting hidden overflow", () => {
		const parent = node(
			"0.0",
			{ x: 20, y: 40, width: 30, height: 50 },
			{ role: "ViewGroup", type: "ViewGroup", label: "" },
		);
		const child = node("0.0.0", { x: 0, y: 40, width: 100, height: 50 });
		const cache = prepareAnnotationCache(
			metadata,
			snapshot([root(), parent, child]),
		);
		const result = selectAnnotationAtPoint(input({ cache }));
		expect(result?.kind === "element" && result.viewportRect.width).toBe(30);
		expect(
			selectAnnotationAtPoint(input({ cache, point: { x: 160, y: 110 } }))
				?.kind,
		).toBe("region");
	});
	test("selects labeled disabled text without invented source identity", () => {
		const text = node("0.0", target().frame, {
			role: "StaticText",
			type: "Text",
			enabled: false,
		});
		const result = selectAnnotationAtPoint(
			input({
				cache: prepareAnnotationCache(metadata, snapshot([root(), text])),
			}),
		);
		expect(result?.kind === "element" && result.element.source).toBeUndefined();
		expect(result?.kind === "element" && result.element.enabled).toBe(false);
	});
	test("rejects invalid frames and duplicate paths", () => {
		const invalid = [
			root(),
			target(),
			target(),
			node("0.1", { x: NaN, y: 0, width: 50, height: 50 }),
			node("0.2", { x: 0, y: 0, width: -1, height: 0 }),
		];
		expect(
			selectAnnotationAtPoint(
				input({ cache: prepareAnnotationCache(metadata, snapshot(invalid)) }),
			)?.kind,
		).toBe("region");
	});
	test("detaches saved target and parents from mutations and later revisions", () => {
		const raw = snapshot();
		raw.elements[1]!.source = {
			kind: "react-native",
			confidence: "exact-testid",
			testID: "source",
			ownerStack: ["Original"],
			props: { text: "Original" },
		};
		const cache = prepareAnnotationCache(metadata, raw),
			result = selectAnnotationAtPoint(input({ cache }));
		if (result?.kind !== "element") throw new Error("Expected an element");
		raw.elements[1]!.frame.x = 90;
		raw.elements[1]!.source!.ownerStack![0] = "Changed";
		expect(result.element.frame.x).toBe(20);
		expect(result.element.source?.ownerStack).toEqual(["Original"]);
		expect(Object.isFrozen(result.element.source?.props)).toBe(true);
		expect(
			validateAnnotationSelection(
				result,
				prepareAnnotationCache({ ...metadata, revision: 2 }, snapshot()),
				identity,
				1500,
			),
		).toBe("revision-changed");
		expect(
			validateAnnotationSelection(result, cache, identity, 1500),
		).toBeNull();
	});
	test("higher windows block smaller background nodes even without eligible foreground nodes", () => {
		const background = node("0", root().frame, { windowId: 1, windowLayer: 0 });
		const modal = node(
			"1",
			{ x: 10, y: 30, width: 200, height: 180 },
			{
				windowId: 2,
				windowLayer: 5,
				role: "ViewGroup",
				type: "ViewGroup",
				label: "",
			},
		);
		const front = node(
			"1.0",
			{ x: 10, y: 30, width: 180, height: 100 },
			{ label: "Modal action" },
		);
		let cache = prepareAnnotationCache(
			metadata,
			snapshot([background, target(), modal, front]),
		);
		const result = selectAnnotationAtPoint(input({ cache }));
		expect(result?.kind === "element" && result.element.label).toBe(
			"Modal action",
		);
		cache = prepareAnnotationCache(
			metadata,
			snapshot([background, target(), modal]),
		);
		const blank = selectAnnotationAtPoint(input({ cache }));
		expect(blank?.kind === "region" && blank.reason).toBe("no-target");
	});
	test("uses an active window or requires a region for ambiguous windows", () => {
		const a = node("0", root().frame, { windowId: 1 }),
			b = node("1", root().frame, { windowId: 2, windowActive: true });
		const front = node("1.0", target().frame, { label: "Active" });
		const raw = snapshot([a, target(), b, front]);
		const selected = selectAnnotationAtPoint(
			input({ cache: prepareAnnotationCache(metadata, raw) }),
		);
		expect(selected?.kind === "element" && selected.element.label).toBe(
			"Active",
		);
		b.windowActive = false;
		const ambiguous = selectAnnotationAtPoint(
			input({ cache: prepareAnnotationCache(metadata, raw) }),
		);
		expect(ambiguous?.kind === "region" && ambiguous.reason).toBe(
			"ambiguous-window",
		);
	});
	test("maps a rotated Android image to the logical cache", () => {
		const android = {
			...identity,
			device: "android:emulator-1",
			platform: "android" as const,
		};
		const result = selectAnnotationAtPoint(
			input({
				identity: android,
				cache: prepareAnnotationCache({ ...metadata, ...android }, snapshot()),
				geometry: {
					viewport: { x: 0, y: 0, width: 600, height: 300 },
					image: { width: 1200, height: 600 },
					axScreen: geometry.axScreen,
					axToImageRotation: 90,
				},
				point: { x: 540, y: 40 },
			}),
		);
		expect(result?.kind).toBe("element");
	});
});

describe("cache freshness and device isolation", () => {
	test("uses 3s on iOS and 10s on unconfirmed Android", () => {
		const ios = prepareAnnotationCache(metadata, snapshot());
		expect(annotationCacheFailure(ios, identity, 4000)).toBeNull();
		expect(annotationCacheFailure(ios, identity, 4001)).toBe("stale-tree");
		const android = { ...identity, platform: "android" as const };
		const cache = prepareAnnotationCache(
			{ ...metadata, ...android },
			snapshot(),
		);
		expect(annotationCacheFailure(cache, android, 11000)).toBeNull();
		expect(annotationCacheFailure(cache, android, 11001)).toBe("stale-tree");
	});
	test("only clean confirmed Android survives elapsed time", () => {
		const android = { ...identity, platform: "android" as const };
		expect(
			annotationCacheFailure(
				prepareAnnotationCache(
					{ ...metadata, ...android, confirmedUnchanged: true },
					snapshot(),
				),
				android,
				900000,
			),
		).toBeNull();
		expect(
			annotationCacheFailure(
				prepareAnnotationCache(
					{ ...metadata, ...android, confirmedUnchanged: true, dirty: true },
					snapshot(),
				),
				android,
				900000,
			),
		).toBe("dirty-tree");
		expect(
			annotationCacheFailure(
				prepareAnnotationCache(
					{ ...metadata, confirmedUnchanged: true },
					snapshot(),
				),
				identity,
				900000,
			),
		).toBe("stale-tree");
	});
	for (const [patch, reason] of [
		[{ connected: false }, "disconnected"],
		[{ dirty: true }, "dirty-tree"],
		[{ collectedAt: 2000 }, "invalid-time"],
		[{ app: null }, "app-changed"],
		[{ app: "different" }, "app-changed"],
		[{ sessionId: "new" }, "session-changed"],
		[{ device: "other" }, "device-changed"],
		[{ orientation: "landscape_left" }, "orientation-changed"],
		[{ platform: "android" }, "platform-changed"],
	] as const)
		test(`falls back for ${reason}`, () => {
			const result = selectAnnotationAtPoint(
				input({
					cache: prepareAnnotationCache({ ...metadata, ...patch }, snapshot()),
				}),
			);
			expect(result?.kind === "region" && result.reason).toBe(reason);
		});
	test("missing and stale trees return bounded image-space regions", () => {
		for (const overrides of [{ cache: null }, { now: 999999 }]) {
			const result = selectAnnotationAtPoint(input(overrides));
			expect(result?.kind === "region" && result.rect).toEqual({
				x: 72,
				y: 132,
				width: 96,
				height: 96,
			});
		}
	});
	test("does not share caches between devices with identical node IDs", () => {
		const second = { ...identity, device: "ios-2" },
			cache = prepareAnnotationCache({ ...metadata, ...second }, snapshot());
		const wrong = selectAnnotationAtPoint(input({ cache }));
		expect(wrong?.kind === "region" && wrong.reason).toBe("device-changed");
		const own = selectAnnotationAtPoint(input({ identity: second, cache }))!;
		expect(own.kind).toBe("element");
		expect(validateAnnotationSelection(own, cache, identity, 1500)).toBe(
			"device-changed",
		);
	});
	test("permits explicit regions when app or orientation is unknown", () => {
		const unknown = { ...identity, app: null, orientation: null };
		const result = selectAnnotationAtPoint(
			input({ identity: unknown, cache: null }),
		)!;
		expect(result.kind).toBe("region");
		expect(validateAnnotationSelection(result, null, unknown, 1500)).toBeNull();
	});
	test("ignores outside pixels and rejects changed screen geometry", () => {
		expect(
			selectAnnotationAtPoint(input({ point: { x: 99, y: 100 } })),
		).toBeNull();
		const result = selectAnnotationAtPoint(
			input({
				geometry: { ...geometry, axScreen: { width: 600, height: 300 } },
			}),
		);
		expect(result?.kind === "region" && result.reason).toBe("geometry-changed");
	});
});
