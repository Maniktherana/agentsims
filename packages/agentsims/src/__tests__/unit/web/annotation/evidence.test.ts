import { expect, test } from "bun:test";
import type { AxElement } from "../../../../core/tools/observe/accessibility-model";
import type { AnnotationIdentity } from "../../../../web/annotation/contracts";
import type { LiveAnnotationNote } from "../../../../web/annotation/live-contracts";
import {
	annotationNoteViewportRect,
	captureAnnotationEvidence,
	exportAnnotationNotes,
} from "../../../../web/annotation/evidence";
import {
	prepareAnnotationCache,
	selectAnnotationAtPoint,
} from "../../../../web/annotation/selection";

const identity: AnnotationIdentity = {
	device: "android:one",
	platform: "android",
	sessionId: "session",
	app: "app",
	orientation: "portrait",
};
const geometry = {
	viewport: { x: 0, y: 0, width: 300, height: 600 },
	image: { width: 900, height: 1800 },
	axScreen: { width: 300, height: 600 },
};
const node: AxElement = {
	id: "transient",
	path: "0.1",
	testId: "unique-target",
	label: "Target",
	value: "",
	role: "button",
	type: "Button",
	enabled: true,
	frame: { x: 20, y: 40, width: 80, height: 50 },
};
function cache(elements = [node], revision = 1) {
	return prepareAnnotationCache(
		{
			...identity,
			revision,
			collectedAt: 1000,
			connected: true,
			dirty: false,
			confirmedUnchanged: false,
		},
		{ screen: geometry.axScreen, elements },
	);
}
function note(element = node): LiveAnnotationNote {
	const selection = selectAnnotationAtPoint({
		identity,
		cache: cache([element]),
		geometry,
		point: { x: 40, y: 60 },
		now: 1500,
	})!;
	return {
		id: "one",
		state: "saved",
		note: "Change it",
		selection,
		imageSize: geometry.image,
		evidence: captureAnnotationEvidence(
			selection,
			geometry,
			{
				src: "data:image/png;base64,Zmlyc3Q=",
				width: 900,
				height: 1800,
				blob: new Blob(["first"]),
			},
			1500,
		),
	};
}

test("pins follow a unique direct native identity without changing captured evidence", () => {
	const original = note();
	const moved = {
		...node,
		id: "new-transient",
		path: "0.7",
		frame: { ...node.frame, x: 100 },
	};
	expect(
		annotationNoteViewportRect(
			original,
			cache([moved], 2),
			identity,
			geometry,
			2000,
		)?.x,
	).toBe(100);
	expect(original.evidence.target.rect.x).toBe(60);
	expect(
		original.selection.kind === "element" && original.selection.element.path,
	).toBe("0.1");
});

test("ambiguous identity, stale trees, and different devices never move a pin", () => {
	const original = note();
	expect(
		annotationNoteViewportRect(
			original,
			cache([node, { ...node, id: "duplicate", path: "0.2" }], 2),
			identity,
			geometry,
			2000,
		),
	).toBeNull();
	expect(
		annotationNoteViewportRect(
			original,
			cache(),
			{ ...identity, device: "android:two" },
			geometry,
			2000,
		),
	).toBeNull();
	expect(
		annotationNoteViewportRect(original, cache(), identity, geometry, 12000),
	).toBeNull();
});

test("a label or inferred React Native owner never acts as a follow identity", () => {
	const inferred = {
		...node,
		testId: undefined,
		source: {
			kind: "react-native" as const,
			confidence: "related-native-id" as const,
			testID: "owner",
			matchReason: "ancestor-owner" as const,
		},
	};
	const original = note(inferred);
	expect(
		annotationNoteViewportRect(
			original,
			cache([{ ...inferred, frame: { ...node.frame, x: 100 } }], 2),
			identity,
			geometry,
			2000,
		),
	).toBeNull();
});

test("capture converts image rotation to the already presented screenshot coordinate space", () => {
	const selection = selectAnnotationAtPoint({
		identity,
		cache: null,
		geometry,
		point: { x: 40, y: 60 },
		now: 1500,
	})!;
	const evidence = captureAnnotationEvidence(
		selection,
		{ ...geometry, imageRotation: 90 },
		{
			src: "data:image/png;base64,Zmlyc3Q=",
			width: 1800,
			height: 900,
			blob: new Blob(["first"]),
		},
		1500,
	);
	expect(evidence.target.rect).toEqual({
		x: 1572,
		y: 72,
		width: 96,
		height: 96,
	});
});

test("prompt keeps each device, actual screenshot and target together without changing captured evidence", () => {
	const android = { ...note(), deviceName: "Pixel 10", note: "Make it red" };
	const selection = {
		...android.selection,
		device: "ios-uuid",
		platform: "ios" as const,
	};
	const ios = {
		...android,
		id: "two",
		deviceName: "iPhone 17",
		note: "Keep the other button blue",
		selection,
		evidence: {
			...android.evidence,
			device: "ios-uuid",
			platform: "ios" as const,
			image: { ...android.evidence.image, base64: "c2Vjb25k" },
			target: {
				...android.evidence.target,
				rect: {
					x: 917.9959902005397,
					y: 866.0000000000001,
					width: 203.99740317749217,
					height: 272.0000000000001,
				},
			},
		},
	};
	const before = structuredClone(ios.evidence);
	const payload = exportAnnotationNotes(
		[android, ios],
		new Map([
			["one", "/tmp/android.png"],
			["two", "/tmp/ios.png"],
		]),
	);
	expect(payload.prompt).toContain(
		"## 1. Pixel 10 (Android)\nChange: Make it red",
	);
	expect(payload.prompt).toContain("Target: Target (button)");
	expect(payload.prompt).toContain("Screenshot: /tmp/android.png");
	expect(payload.prompt).toContain(
		"## 2. iPhone 17 (iOS)\nChange: Keep the other button blue",
	);
	expect(payload.prompt).toContain(
		"Bounds: x 918, y 866, 204 × 272 px in the captured screenshot\nScreenshot: /tmp/ios.png",
	);
	expect(payload.prompt).not.toContain("ios-uuid");
	expect(payload.prompt).not.toContain("Captured:");
	expect(payload.prompt).not.toContain("attachment");
	expect(payload.images.map((image) => image.base64)).toEqual([
		android.evidence.image.base64,
		ios.evidence.image.base64,
	]);
	expect(ios.evidence).toEqual(before);
});

test("a captured native label explains a region without claiming source identity", () => {
	const selection = selectAnnotationAtPoint({
		identity,
		cache: null,
		geometry,
		point: { x: 40, y: 60 },
		now: 1500,
	})!;
	if (selection.kind !== "region") throw new Error("Expected screen region");
	const original = {
		...note(),
		selection: { ...selection, previewLabel: "Save (button)" },
		evidence: captureAnnotationEvidence(
			selection,
			geometry,
			{
				src: "data:image/png;base64,Zmlyc3Q=",
				width: 900,
				height: 1800,
				blob: new Blob(["first"]),
			},
			1500,
		),
	};
	const payload = exportAnnotationNotes([original]);
	expect(payload.prompt).toContain("## 1. Android device");
	expect(payload.prompt).toContain("Target: Save (button)");
	expect(payload.prompt).not.toContain("Source:");
	expect(payload.prompt).not.toContain("App:");
	expect(original.evidence.target.kind).toBe("region");
});
