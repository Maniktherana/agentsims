import { expect, test } from "bun:test";
import { annotationClipboardCaptures } from "../../../../web/annotation/clipboard-image";
import type { AnnotationSendPayload } from "../../../../web/annotation/live-contracts";

const image = (id: string, base64: string) => ({
	id,
	mimeType: "image/png" as const,
	width: 100,
	height: 200,
	base64,
});
const rect = (y: number) => ({ x: 10, y, width: 20, height: 20 });

test("notes that share one capture produce one image with all their markers", () => {
	const payload: AnnotationSendPayload = {
		prompt: "",
		images: [image("a", "AAAA"), image("b", "AAAA"), image("c", "BBBB")],
		markers: [
			{ imageId: "a", number: 1, rect: rect(10) },
			{ imageId: "b", number: 2, rect: rect(50) },
			{ imageId: "c", number: 3, rect: rect(90) },
		],
	};
	const captures = annotationClipboardCaptures(payload);
	expect(captures).toHaveLength(2);
	expect(captures[0]!.number).toBe(1);
	expect(captures[0]!.markers.map((marker) => marker.number)).toEqual([1, 2]);
	expect(captures[1]!.number).toBe(3);
	expect(captures[1]!.markers).toEqual([{ number: 3, rect: rect(90) }]);
});
