import type {
	AxElement,
	AxRect,
} from "../../core/tools/observe/accessibility-model";
import type {
	AnnotationGeometry,
	AnnotationIdentity,
	AnnotationSelection,
	AnnotationSelectionCache,
} from "./contracts";
import type {
	AnnotationEvidence,
	AnnotationSendPayload,
	LiveAnnotationNote,
} from "./live-contracts";
import type { RenderedScreenshot } from "../simulator/screenshot/rendered-screenshot";
import {
	annotationAxRectToImage,
	annotationImageRectToViewport,
} from "./geometry";
import { annotationCacheFailure } from "./selection";

export function freezeAnnotationValue<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freezeAnnotationValue(child);
		Object.freeze(value);
	}
	return value;
}

export function captureAnnotationEvidence(
	selection: AnnotationSelection,
	geometry: AnnotationGeometry,
	capture: RenderedScreenshot,
	capturedAt: number,
): AnnotationEvidence {
	const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(
		capture.src,
	);
	if (!match || capture.blob.size > 8 * 1024 * 1024)
		throw new Error("The captured image is too large or unavailable.");
	const rect = annotationImageRectToViewport(
		selection.kind === "element" ? selection.imageRect : selection.rect,
		{
			...geometry,
			viewport: { x: 0, y: 0, width: capture.width, height: capture.height },
			clip: undefined,
		},
	);
	if (!rect) throw new Error("The selected region is unavailable.");
	return freezeAnnotationValue(
		structuredClone({
			kind: "annotation",
			device: selection.identity.device,
			platform: selection.identity.platform,
			sessionId: selection.identity.sessionId,
			capturedAt,
			note: "",
			logs: [],
			image: {
				mimeType: match[1] as "image/png" | "image/jpeg",
				width: capture.width,
				height: capture.height,
				base64: match[2]!,
			},
			target:
				selection.kind === "region"
					? { kind: "region", rect, reason: selection.reason }
					: {
							kind: "element",
							rect,
							revision: selection.metadata.revision,
							collectedAt: selection.metadata.collectedAt,
							app: selection.identity.app!,
							orientation: selection.identity.orientation!,
							element: selection.element,
						},
		} satisfies AnnotationEvidence),
	);
}

function sameIdentity(a: AnnotationIdentity, b: AnnotationIdentity): boolean {
	return (
		a.device === b.device &&
		a.sessionId === b.sessionId &&
		a.platform === b.platform &&
		a.app === b.app &&
		a.orientation === b.orientation
	);
}

function stableElementMatch(a: AxElement, b: AxElement): boolean {
	if (a.role !== b.role || a.type !== b.type) return false;
	if (a.sourceId !== undefined && a.windowId !== undefined)
		return a.sourceId === b.sourceId && a.windowId === b.windowId;
	if (a.testId) return a.testId === b.testId;
	if (a.nativeId) return a.nativeId === b.nativeId;
	return false;
}

/** Only visual pins move. Their captured target and image never change. */
export function annotationNoteViewportRect(
	note: LiveAnnotationNote,
	cache: AnnotationSelectionCache | null,
	identity: AnnotationIdentity,
	geometry: AnnotationGeometry,
	now: number,
): AxRect | null {
	if (!sameIdentity(note.selection.identity, identity)) return null;
	if (note.selection.kind === "element") {
		if (annotationCacheFailure(cache, identity, now)) return null;
		if (
			cache!.snapshot.screen.width !== geometry.axScreen.width ||
			cache!.snapshot.screen.height !== geometry.axScreen.height
		)
			return null;
		if (cache!.metadata.revision === note.selection.metadata.revision)
			return annotationImageRectToViewport(note.selection.imageRect, geometry);
		const matches = cache!.elements.filter(
			(entry) =>
				entry.meaningful &&
				stableElementMatch(
					note.selection.kind === "element"
						? note.selection.element
						: entry.element,
					entry.element,
				),
		);
		if (matches.length !== 1) return null;
		const rect = annotationAxRectToImage(matches[0]!.frame, geometry);
		return rect && annotationImageRectToViewport(rect, geometry);
	}
	const rect = note.selection.rect;
	return annotationImageRectToViewport(
		{
			x: (rect.x * geometry.image.width) / note.imageSize.width,
			y: (rect.y * geometry.image.height) / note.imageSize.height,
			width: (rect.width * geometry.image.width) / note.imageSize.width,
			height: (rect.height * geometry.image.height) / note.imageSize.height,
		},
		geometry,
	);
}

export function exportAnnotationNotes(
	notes: readonly LiveAnnotationNote[],
	imagePaths?: ReadonlyMap<string, string>,
): AnnotationSendPayload {
	const images = notes.map((note) => ({ id: note.id, ...note.evidence.image }));
	const prompt = notes
		.map((note, index) => {
			const evidence = note.evidence;
			const rect = evidence.target.rect;
			const platform = evidence.platform === "ios" ? "iOS" : "Android";
			const label =
				evidence.target.kind === "element"
					? `${evidence.target.element.label || evidence.target.element.type}${evidence.target.element.role ? ` (${evidence.target.element.role})` : ""}`
					: note.selection.kind === "region"
						? note.selection.previewLabel
						: undefined;
			const lines = [
				`## ${index + 1}. ${note.deviceName ? `${note.deviceName} (${platform})` : `${platform} device`}`,
				`Change: ${note.note}`,
				`Target: ${label || "Selected screen region"}`,
				`Bounds: x ${Math.round(rect.x)}, y ${Math.round(rect.y)}, ${Math.round(rect.width)} × ${Math.round(rect.height)} px in the captured screenshot`,
				`Screenshot: ${imagePaths?.get(note.id) || `image ${index + 1}`}`,
			];
			const source =
				evidence.target.kind === "element"
					? evidence.target.element.source
					: undefined;
			if (evidence.target.kind === "element")
				lines.splice(2, 0, `App: ${evidence.target.app}`);
			if (source?.file && source.line)
				lines.push(`Source: ${source.file}:${source.line}`);
			return lines.join("\n");
		})
		.join("\n\n");
	return freezeAnnotationValue({
		prompt: `Apply these changes to the app screens.\n\n${prompt}`,
		images,
	});
}
