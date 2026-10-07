import { describe, expect, test } from "bun:test";
import type { AxElement } from "../../../../core/tools/observe/accessibility-model";
import type {
	AnnotationGeometry,
	AnnotationIdentity,
} from "../../../../web/annotation/contracts";
import type { AnnotationNativePreview } from "../../../../web/annotation/live-contracts";
import {
	prepareNativeAnnotationPreview,
	selectNativeAnnotationPreview,
} from "../../../../web/annotation/native-preview";

const identity: AnnotationIdentity = {
	device: "ios-one",
	platform: "ios",
	sessionId: "view:one",
	app: "example",
	orientation: "portrait",
};
const geometry: AnnotationGeometry = {
	viewport: { x: 100, y: 40, width: 300, height: 600 },
	image: { width: 900, height: 1800 },
	axScreen: { width: 900, height: 1800 },
};
function element(change: Partial<AxElement> = {}): AxElement {
	return {
		id: "button",
		path: "0.1",
		label: "Like",
		value: "",
		role: "button",
		type: "Button",
		enabled: true,
		frame: { x: 20, y: 50, width: 80, height: 40 },
		...change,
	};
}
function preview(elements = [element()]): AnnotationNativePreview {
	return {
		identity,
		connected: true,
		status: `${elements.length} AX elements`,
		snapshot: { screen: { width: 300, height: 600 }, elements },
	};
}

describe("bare native annotation preview", () => {
	test("iOS logical points map to actual image pixels without cache metadata", () => {
		const native = preview();
		const spatial = prepareNativeAnnotationPreview(native);
		const target = selectNativeAnnotationPreview(
			native,
			identity,
			geometry,
			{ x: 140, y: 110 },
			spatial,
		)!;
		expect(target.viewportRect).toEqual({
			x: 120,
			y: 90,
			width: 80,
			height: 40,
		});
		expect(target.rect).toEqual({ x: 60, y: 150, width: 240, height: 120 });
		expect(target.kind).toBe("region");
		expect(target.reason).toBe("unknown-identity");
		expect("metadata" in spatial).toBe(false);
		expect("element" in target).toBe(false);
		expect("revision" in target).toBe(false);
	});
	test("Android pixel bounds use the same native target mapping", () => {
		const native = preview([
			element({
				type: "android.widget.Button",
				frame: { x: 60, y: 150, width: 240, height: 120 },
			}),
		]);
		native.snapshot!.screen = { width: 900, height: 1800 };
		const android = {
			...identity,
			platform: "android" as const,
			device: "android:one",
		};
		const target = selectNativeAnnotationPreview(
			{ ...native, identity: android },
			android,
			geometry,
			{ x: 140, y: 110 },
		);
		expect(target?.viewportRect).toEqual({
			x: 120,
			y: 90,
			width: 80,
			height: 40,
		});
		expect(target?.rect).toEqual({ x: 60, y: 150, width: 240, height: 120 });
	});
	test("Android top window blocks a background leaf, even when its foreground has no target", () => {
		const native = preview([
			element({
				path: "0",
				label: "",
				role: "view",
				type: "android.widget.FrameLayout",
				frame: { x: 0, y: 0, width: 300, height: 600 },
				windowId: 1,
				windowLayer: 0,
			}),
			element({ path: "0.1", windowId: 1, windowLayer: 0 }),
			element({
				path: "1",
				label: "",
				role: "view",
				type: "android.widget.FrameLayout",
				frame: { x: 0, y: 0, width: 300, height: 600 },
				windowId: 2,
				windowLayer: 2,
			}),
		]);
		expect(
			selectNativeAnnotationPreview(native, identity, geometry, {
				x: 140,
				y: 110,
			}),
		).toBeNull();
		native.snapshot!.elements.push(
			element({
				path: "1.1",
				windowId: 2,
				windowLayer: 2,
				frame: { x: 15, y: 45, width: 100, height: 60 },
			}),
		);
		expect(
			selectNativeAnnotationPreview(native, identity, geometry, {
				x: 140,
				y: 110,
			})?.rect,
		).toEqual({ x: 45, y: 135, width: 300, height: 180 });
	});
	test("clips native children and rejects letterbox or hidden nodes", () => {
		const native = preview([
			element({
				path: "0",
				label: "",
				type: "ScrollView",
				role: "view",
				frame: { x: 20, y: 50, width: 60, height: 40 },
			}),
			element(),
		]);
		expect(
			selectNativeAnnotationPreview(native, identity, geometry, {
				x: 140,
				y: 110,
			})?.rect.width,
		).toBe(180);
		expect(
			selectNativeAnnotationPreview(
				preview([element({ visibleToUser: false })]),
				identity,
				geometry,
				{ x: 140, y: 110 },
			),
		).toBeNull();
		expect(
			selectNativeAnnotationPreview(
				preview(),
				identity,
				{ ...geometry, viewport: { x: 0, y: 0, width: 600, height: 600 } },
				{ x: 50, y: 110 },
			),
		).toBeNull();
	});
	test("rotation preserves actual native AX bounds", () => {
		const rotated: AnnotationGeometry = {
			viewport: { x: 0, y: 0, width: 600, height: 300 },
			image: { width: 1800, height: 900 },
			axScreen: { width: 300, height: 600 },
			axToImageRotation: 90,
		};
		const target = selectNativeAnnotationPreview(preview(), identity, rotated, {
			x: 530,
			y: 40,
		});
		expect(target?.viewportRect).toEqual({
			x: 510,
			y: 20,
			width: 40,
			height: 80,
		});
		expect(target?.rect).toEqual({ x: 1530, y: 60, width: 120, height: 240 });
	});
	test("source ownership cannot create a native hover target", () => {
		const source = {
			kind: "react-native" as const,
			confidence: "exact-testid" as const,
			testID: "owner",
			elementName: "Pressable",
		};
		expect(
			selectNativeAnnotationPreview(
				preview([element({ label: "", type: "View", role: "view", source })]),
				identity,
				geometry,
				{ x: 140, y: 110 },
			),
		).toBeNull();
	});
	for (const status of [
		"AX waiting",
		"AX off",
		"Refreshing AX",
		"AX reconnecting",
		"AX refresh failed (503)",
	]) {
		test(`${status} clears preview`, () =>
			expect(
				selectNativeAnnotationPreview(
					{ ...preview(), status },
					identity,
					geometry,
					{ x: 140, y: 110 },
				),
			).toBeNull());
	}
	test("native capture errors, disconnect, and identity changes clear preview", () => {
		const native = preview();
		native.snapshot!.errors = ["Android AX server exited (137): Killed"];
		expect(
			selectNativeAnnotationPreview(native, identity, geometry, {
				x: 140,
				y: 110,
			}),
		).toBeNull();
		expect(
			selectNativeAnnotationPreview(
				{ ...preview(), connected: false },
				identity,
				geometry,
				{ x: 140, y: 110 },
			),
		).toBeNull();
		for (const changed of [
			{ device: "two" },
			{ sessionId: "view:two" },
			{ app: "other" },
			{ orientation: "landscape_left" as const },
		])
			expect(
				selectNativeAnnotationPreview(
					preview(),
					{ ...identity, ...changed },
					geometry,
					{ x: 140, y: 110 },
				),
			).toBeNull();
	});
});
