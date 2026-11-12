import type { AxRect } from "../../core/tools/observe/accessibility-model";
import type { AnnotationSendPayload } from "./live-contracts";

export interface AnnotationClipboardCapture {
	readonly image: AnnotationSendPayload["images"][number];
	/** The number of the first note on this capture. The prompt cites this image number. */
	readonly number: number;
	readonly markers: readonly { readonly number: number; readonly rect: AxRect }[];
}

/**
 * One entry for each distinct capture. Notes whose image bytes are identical
 * share one picture with all of their numbered markers.
 */
export function annotationClipboardCaptures(
	payload: AnnotationSendPayload,
): readonly AnnotationClipboardCapture[] {
	const captures = new Map<
		string,
		{
			image: AnnotationClipboardCapture["image"];
			number: number;
			markers: { number: number; rect: AxRect }[];
		}
	>();
	const byImage = new Map<string, string>();
	payload.images.forEach((image, index) => {
		const key = `${image.mimeType};${image.base64}`;
		byImage.set(image.id, key);
		if (!captures.has(key))
			captures.set(key, { image, number: index + 1, markers: [] });
	});
	for (const marker of payload.markers ?? []) {
		const key = byImage.get(marker.imageId);
		if (key) captures.get(key)!.markers.push({ number: marker.number, rect: marker.rect });
	}
	return [...captures.values()];
}
