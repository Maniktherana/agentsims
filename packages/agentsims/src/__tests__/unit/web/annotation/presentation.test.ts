import { describe, expect, test } from "bun:test";
import type { LiveAnnotationNote } from "../../../../web/annotation/live-contracts";
import {
	annotationCapturedPreview,
	annotationSendNotification,
} from "../../../../web/annotation/presentation";

function note(
	width: number,
	height: number,
	platform: "ios" | "android",
): LiveAnnotationNote {
	return {
		id: "retained-comment",
		state: "draft",
		note: "A complete comment remains available while its preview is clipped.\n".repeat(
			40,
		),
		imageSize: { width, height },
		selection: {
			kind: "region",
			identity: {
				device: platform,
				platform,
				sessionId: "view:one",
				app: null,
				orientation: null,
			},
			coordinateSpace: "image-pixels",
			rect: {
				x: width / 4,
				y: height / 4,
				width: width / 2,
				height: height / 2,
			},
			viewportRect: { x: 0, y: 0, width: 100, height: 100 },
			reason: "unknown-identity",
		},
		evidence: {
			kind: "annotation",
			device: platform,
			platform,
			sessionId: "view:one",
			capturedAt: 1000,
			note: "",
			logs: [],
			image: { width, height, mimeType: "image/png", base64: btoa("captured") },
			target: {
				kind: "region",
				rect: {
					x: width / 4,
					y: height / 4,
					width: width / 2,
					height: height / 2,
				},
				reason: "unknown-identity",
			},
		},
	};
}

describe("captured comment preview", () => {
	for (const [platform, width, height] of [
		["ios", 1170, 2532],
		["android", 1080, 2424],
		["ios", 2532, 1170],
		["android", 2424, 1080],
	] as const) {
		test(`${platform} ${width} by ${height}: keeps the captured image ratio and exact target without letterboxing`, () => {
			const original = note(width, height, platform);
			const preview = annotationCapturedPreview(original);
			expect(preview.height).toBe(96);
			expect(preview.width / preview.height).toBeCloseTo(width / height);
			expect(preview.target?.x).toBeCloseTo(preview.width / 4);
			expect(preview.target?.y).toBeCloseTo(24);
			expect(preview.target?.width).toBeCloseTo(preview.width / 2);
			expect(preview.target?.height).toBeCloseTo(48);
		});
	}
	test("preview sizing leaves the captured image, target and full editable text unchanged", () => {
		const original = note(1080, 2424, "android");
		const image = original.evidence.image;
		const target = original.evidence.target;
		const text = original.note;
		annotationCapturedPreview(original);
		annotationCapturedPreview(original, 72);
		expect(original.evidence.image).toBe(image);
		expect(original.evidence.target).toBe(target);
		expect(original.note).toBe(text);
	});
});

describe("Send toast feedback", () => {
	test("only a confirmed Send reports success", () => {
		expect(annotationSendNotification({ status: "sent" }).kind).toBe("success");
		for (const status of ["unavailable", "failed", "unknown"] as const)
			expect(annotationSendNotification({ status }).kind).toBe("error");
	});
	test("unknown delivery directs the user to check before sending again", () => {
		const feedback = annotationSendNotification({ status: "unknown" });
		expect(feedback.title).toBe("Send status is unknown");
		expect(feedback.description).toContain(
			"Check the conversation before sending again",
		);
		expect(feedback.description).toContain("retained");
	});
	test("a backend failure keeps its actual explanation; other failures retain Copy recovery", () => {
		expect(
			annotationSendNotification({
				status: "failed",
				message: "The host disconnected before dispatch.",
			}).description,
		).toBe("The host disconnected before dispatch.");
		expect(
			annotationSendNotification({ status: "unavailable" }).description,
		).toContain("Use Copy prompt");
	});
});
