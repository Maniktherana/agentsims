import type {
	AnnotationGeometry,
	AnnotationIdentity,
	AnnotationPoint,
	AnnotationRegionSelection,
	AnnotationSpatialSnapshot,
} from "./contracts";
import type { AnnotationNativePreview } from "./live-contracts";
import { freezeAnnotationValue } from "./evidence";
import {
	prepareAnnotationSpatialSnapshot,
	selectAnnotationSpatialTargets,
} from "./selection";

export function annotationIdentityKey(identity: AnnotationIdentity): string {
	return JSON.stringify([
		identity.device,
		identity.sessionId,
		identity.platform,
		identity.app,
		identity.orientation,
	]);
}

export function nativeAnnotationPreviewAvailable(
	preview: AnnotationNativePreview | undefined,
	identity: AnnotationIdentity,
): boolean {
	return !!(
		preview?.connected &&
		preview.snapshot?.elements.length &&
		!preview.snapshot.errors?.length &&
		annotationIdentityKey(preview.identity) ===
			annotationIdentityKey(identity) &&
		!/(off|waiting|refreshing|reconnecting|unavailable|disconnect|error|failed)/i.test(
			preview.status,
		)
	);
}

export function prepareNativeAnnotationPreview(
	preview: AnnotationNativePreview,
): AnnotationSpatialSnapshot {
	// Preview ranking uses native semantics only. Source ownership is not node identity.
	const snapshot = preview.snapshot!;
	return prepareAnnotationSpatialSnapshot({
		...snapshot,
		elements: snapshot.elements.map(
			({ source: _source, ...element }) => element,
		),
	});
}

export function selectNativeAnnotationPreview(
	preview: AnnotationNativePreview | undefined,
	identity: AnnotationIdentity,
	geometry: AnnotationGeometry,
	point: AnnotationPoint,
	spatial?: AnnotationSpatialSnapshot | null,
): AnnotationRegionSelection | null {
	if (!nativeAnnotationPreviewAvailable(preview, identity)) return null;
	const native = spatial ?? prepareNativeAnnotationPreview(preview!);
	const target = selectAnnotationSpatialTargets(
		native,
		{ ...geometry, axScreen: native.snapshot.screen },
		point,
	).candidates[0];
	return target
		? freezeAnnotationValue({
				kind: "region" as const,
				identity: { ...identity },
				coordinateSpace: "image-pixels" as const,
				rect: { ...target.imageRect },
				viewportRect: { ...target.viewportRect },
				reason: "unknown-identity" as const,
				previewLabel: target.element.label
					? `${target.element.label} (${target.element.role || target.element.type})`
					: undefined,
			})
		: null;
}
