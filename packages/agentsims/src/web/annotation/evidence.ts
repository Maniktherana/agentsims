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
import { annotationTargetStructure } from "./structure";
import { CONTEXT_LIMITS } from "../../core/tools/context/contracts";
import {
	formatContextPrompt,
	type ContextPromptDetail,
} from "../../core/tools/context/prompt";

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
	/** The cache that produced an element selection, and the device display name. */
	context: {
		cache?: AnnotationSelectionCache | null;
		deviceName?: string;
	} = {},
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
	const cache = context.cache;
	// Structure comes only from the tree revision that produced the selection.
	const structure =
		selection.kind === "element" &&
		cache &&
		cache.metadata.revision === selection.metadata.revision &&
		cache.metadata.device === selection.identity.device &&
		cache.metadata.sessionId === selection.identity.sessionId
			? annotationTargetStructure(cache, selection.key)
			: undefined;
	// Structure is optional. Never let it push the target past the store limit.
	const structureFits =
		!!structure &&
		selection.kind === "element" &&
		new TextEncoder().encode(
			JSON.stringify({ rect, element: selection.element, structure }),
		).length <=
			CONTEXT_LIMITS.targetBytes - 1024;
	const overlaps =
		selection.kind === "region"
			? selection.previewLabel?.trim().slice(0, CONTEXT_LIMITS.structureText)
			: undefined;
	const deviceName = context.deviceName
		?.trim()
		.slice(0, CONTEXT_LIMITS.deviceNameCharacters);
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
					? {
							kind: "region",
							rect,
							reason: selection.reason,
							...(overlaps ? { overlaps } : {}),
						}
					: {
							kind: "element",
							rect,
							revision: selection.metadata.revision,
							collectedAt: selection.metadata.collectedAt,
							app: selection.identity.app!,
							orientation: selection.identity.orientation!,
							element: selection.element,
							...(structureFits ? { structure } : {}),
						},
			...(deviceName ? { deviceName } : {}),
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
	detail: ContextPromptDetail = "standard",
): AnnotationSendPayload {
	const images = notes.map((note) => ({ id: note.id, ...note.evidence.image }));
	const markers = notes.map((note, index) => ({
		imageId: note.id,
		number: index + 1,
		rect: { ...note.evidence.target.rect },
	}));
	const prompt = formatContextPrompt(
		notes.map((note) => ({
			note: note.note,
			evidence: note.evidence,
			deviceName: note.deviceName,
			screenshot: imagePaths?.get(note.id),
		})),
		detail,
	);
	return freezeAnnotationValue({ prompt, images, markers });
}
