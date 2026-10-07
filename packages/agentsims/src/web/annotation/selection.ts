import type {
	AxElement,
	AxRect,
	AxSnapshot,
} from "../../core/tools/observe/accessibility-model";
import {
	axElementKey,
	hasHumanLabel,
	isContainerRole,
} from "../accessibility/ax";
import type {
	AnnotationCacheMetadata,
	AnnotationCachedElement,
	AnnotationCachedWindow,
	AnnotationElementSelection,
	AnnotationElementTarget,
	AnnotationFallbackReason,
	AnnotationIdentity,
	AnnotationRegionSelection,
	AnnotationSelection,
	AnnotationSelectionCache,
	AnnotationSelectionInput,
	AnnotationSpatialSnapshot,
	AnnotationGeometry,
	AnnotationPoint,
} from "./contracts";
import {
	annotationAxRectToImage,
	annotationImagePointToAx,
	annotationImageRectToViewport,
	annotationRectContains,
	intersectAnnotationRects,
	validAnnotationRect,
	validAnnotationSize,
	viewportPointToAnnotationImage,
	viewportRegionToAnnotationImage,
} from "./geometry";

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function copy<T>(value: T): T {
	return freeze(structuredClone(value));
}

function parentPath(path: string): string | null {
	const end = Math.max(path.lastIndexOf("."), path.lastIndexOf("/"));
	return end > 0 ? path.slice(0, end) : null;
}

function pathParents(
	path: string,
	elements: ReadonlyMap<string, AxElement>,
): AxElement[] {
	const result: AxElement[] = [];
	let parent = parentPath(path);
	while (parent !== null) {
		const element = elements.get(parent);
		if (element) result.push(element);
		parent = parentPath(parent);
	}
	return result;
}

function actionRank(element: AxElement): number {
	const role = `${element.role} ${element.type}`.toLowerCase();
	if (
		/button|textfield|text field|edittext|switch|checkbox|radio|slider|seekbar|spinner|link|menuitem/.test(
			role,
		)
	)
		return 3;
	if (
		element.traits?.some((trait) =>
			/clickable|button|link|adjustable|long press/i.test(trait),
		)
	)
		return 2;
	if (
		element.actions?.some((action) =>
			/click|press|tap|set.?text|set.?progress/i.test(action),
		)
	)
		return 2;
	const source = element.source;
	const direct =
		source &&
		(!source.matchReason ||
			["test-id", "native-id", "element-id"].includes(source.matchReason));
	return direct &&
		/button|pressable|touchable|input/i.test(source.elementName ?? "")
		? 1
		: 0;
}

/** Source ownership alone does not make a decorative node selectable. */
export function isMeaningfulAnnotationElement(
	element: AxElement,
	frame: AxRect,
	screen: AxRect,
): boolean {
	const ratio = (frame.width * frame.height) / (screen.width * screen.height);
	if (ratio > 0.72) return false;
	const actionable = actionRank(element) > 0;
	if (isContainerRole(element) && !actionable && ratio > 0.35) return false;
	return actionable || hasHumanLabel(element);
}

function union(a: AxRect | null, b: AxRect | null): AxRect | null {
	if (!a) return b;
	if (!b) return a;
	const x = Math.min(a.x, b.x),
		y = Math.min(a.y, b.y);
	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

/** Call after an AX cache changes, never for each video frame. */
export function prepareAnnotationSpatialSnapshot(
	snapshot: AxSnapshot,
): AnnotationSpatialSnapshot {
	const detached = copy(snapshot);
	const screen: AxRect = { x: 0, y: 0, ...detached.screen };
	const counts = new Map<string, number>();
	for (const element of detached.elements)
		counts.set(element.path, (counts.get(element.path) ?? 0) + 1);
	const nodes = detached.elements.filter(
		(element) => counts.get(element.path) === 1,
	);
	const byPath = new Map(nodes.map((element) => [element.path, element]));
	const hasWindows = nodes.some(
		(element) =>
			element.windowId !== undefined || element.windowLayer !== undefined,
	);
	const windows = new Map<string, AnnotationCachedWindow>();
	const elements: AnnotationCachedElement[] = [];
	for (const element of nodes) {
		const parents = pathParents(element.path, byPath);
		if (
			element.visibleToUser === false ||
			parents.some((parent) => parent.visibleToUser === false)
		)
			continue;
		const chain = [element, ...parents];
		const root = chain.at(-1)!;
		const window = chain.find((node) => node.windowId !== undefined);
		const windowKey = hasWindows
			? window
				? `window:${window.windowId}`
				: `root:${root.path}`
			: "default";
		let frame = intersectAnnotationRects(element.frame, screen);
		for (const parent of parents) {
			if (frame && validAnnotationRect(parent.frame))
				frame = intersectAnnotationRects(frame, parent.frame);
		}
		const prior = windows.get(windowKey);
		const layer =
			chain.find((node) => node.windowLayer !== undefined)?.windowLayer ?? null;
		windows.set(windowKey, {
			key: windowKey,
			frame: union(prior?.frame ?? null, frame),
			layer:
				prior?.layer === undefined || prior.layer === null
					? layer
					: prior.layer,
			active:
				(prior?.active ?? false) ||
				chain.some((node) => node.windowActive === true),
			focused:
				(prior?.focused ?? false) ||
				chain.some((node) => node.windowFocused === true),
		});
		if (!frame) continue;
		elements.push({
			key: axElementKey(element),
			element,
			frame,
			parentKeys: parents.map(axElementKey),
			windowKey,
			meaningful: isMeaningfulAnnotationElement(element, frame, screen),
		});
	}
	return freeze({
		snapshot: detached,
		elements,
		windows: Array.from(windows.values()),
	});
}

export function prepareAnnotationCache(
	metadata: AnnotationCacheMetadata,
	snapshot: AxSnapshot,
): AnnotationSelectionCache {
	return freeze({
		...prepareAnnotationSpatialSnapshot(snapshot),
		metadata: copy(metadata),
	});
}

function identityFailure(
	actual: AnnotationIdentity,
	expected: AnnotationIdentity,
	requireKnown = true,
): AnnotationFallbackReason | null {
	if (actual.device !== expected.device) return "device-changed";
	if (actual.sessionId !== expected.sessionId) return "session-changed";
	if (actual.platform !== expected.platform) return "platform-changed";
	if (actual.app !== expected.app) return "app-changed";
	if (actual.orientation !== expected.orientation) return "orientation-changed";
	if (
		!actual.device ||
		!actual.sessionId ||
		(requireKnown && (!actual.app || !actual.orientation))
	)
		return "unknown-identity";
	return null;
}

export function annotationCacheFailure(
	cache: AnnotationSelectionCache | null,
	identity: AnnotationIdentity,
	now: number,
): AnnotationFallbackReason | null {
	if (!cache) return "missing-tree";
	const metadata = cache.metadata;
	const identityReason = identityFailure(metadata, identity);
	if (identityReason) return identityReason;
	if (!metadata.connected) return "disconnected";
	if (metadata.dirty) return "dirty-tree";
	if (
		!Number.isFinite(now) ||
		!Number.isFinite(metadata.collectedAt) ||
		now < metadata.collectedAt
	)
		return "invalid-time";
	if (!Number.isSafeInteger(metadata.revision) || metadata.revision < 0)
		return "unknown-identity";
	if (
		!cache.elements.length ||
		cache.snapshot.errors?.length ||
		!validAnnotationSize(cache.snapshot.screen)
	)
		return "unavailable-tree";
	if (metadata.platform === "android" && metadata.confirmedUnchanged)
		return null;
	return now - metadata.collectedAt >
		(metadata.platform === "ios" ? 3000 : 10000)
		? "stale-tree"
		: null;
}

function topWindow(
	cache: AnnotationSpatialSnapshot,
	point: { x: number; y: number },
): string | null {
	let covering = cache.windows.filter(
		(window) => window.frame && annotationRectContains(window.frame, point),
	);
	if (covering.length === 1) return covering[0]!.key;
	if (!covering.length) return null;
	if (covering.every((window) => window.layer !== null)) {
		const top = Math.max(...covering.map((window) => window.layer!));
		covering = covering.filter((window) => window.layer === top);
		if (covering.length === 1) return covering[0]!.key;
	}
	const active = covering.filter((window) => window.active || window.focused);
	return active.length === 1 ? active[0]!.key : null;
}

function region(
	input: AnnotationSelectionInput,
	reason: AnnotationFallbackReason,
): AnnotationRegionSelection | null {
	const size = input.regionSize ?? { width: 32, height: 32 };
	if (!validAnnotationSize(size)) return null;
	const rect = viewportRegionToAnnotationImage(
		{
			x: input.point.x - size.width / 2,
			y: input.point.y - size.height / 2,
			...size,
		},
		input.geometry,
	);
	const viewportRect =
		rect && annotationImageRectToViewport(rect, input.geometry);
	return rect && viewportRect
		? copy({
				kind: "region",
				identity: input.identity,
				coordinateSpace: "image-pixels",
				rect,
				viewportRect,
				reason,
			})
		: null;
}

/** Returns one local target, or a region. Letterbox and clipped pixels return null. */
export function selectAnnotationAtPoint(
	input: AnnotationSelectionInput,
): AnnotationSelection | null {
	const imagePoint = viewportPointToAnnotationImage(
		input.point,
		input.geometry,
	);
	if (!imagePoint) return null;
	const failure = annotationCacheFailure(
		input.cache,
		input.identity,
		input.now,
	);
	if (failure) return region(input, failure);
	const cache = input.cache!;
	const { candidates, reason } = selectAnnotationSpatialTargets(
		cache,
		input.geometry,
		input.point,
	);
	if (!candidates.length) return region(input, reason ?? "no-target");
	return copy({
		kind: "element",
		identity: input.identity,
		metadata: cache.metadata,
		...candidates[0]!,
		candidates,
		candidateIndex: 0,
	});
}

/** Native bounds and ranking without cache metadata or a source-aware claim. */
export function selectAnnotationSpatialTargets(
	cache: AnnotationSpatialSnapshot,
	geometry: AnnotationGeometry,
	point: AnnotationPoint,
): {
	candidates: readonly AnnotationElementTarget[];
	reason: AnnotationFallbackReason | null;
} {
	const imagePoint = viewportPointToAnnotationImage(point, geometry);
	if (!imagePoint) return { candidates: [], reason: "no-target" };
	if (
		cache.snapshot.screen.width !== geometry.axScreen.width ||
		cache.snapshot.screen.height !== geometry.axScreen.height
	)
		return { candidates: [], reason: "geometry-changed" };
	const axPoint = annotationImagePointToAx(imagePoint, geometry);
	if (!axPoint) return { candidates: [], reason: "geometry-changed" };
	const windowKey = topWindow(cache, axPoint);
	if (!windowKey) return { candidates: [], reason: "ambiguous-window" };
	const hits = cache.elements.filter(
		(candidate) =>
			candidate.windowKey === windowKey &&
			candidate.meaningful &&
			annotationRectContains(candidate.frame, axPoint),
	);
	hits.sort((a, b) => {
		const area =
			a.frame.width * a.frame.height - b.frame.width * b.frame.height;
		if (area) return area;
		const depth =
			b.element.path.split(/[./]/).length - a.element.path.split(/[./]/).length;
		if (depth) return depth;
		const rank = actionRank(b.element) - actionRank(a.element);
		return rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
	});
	const hit = hits[0];
	if (!hit) return { candidates: [], reason: "no-target" };
	const candidates = [
		hit,
		...hit.parentKeys.flatMap((key) => {
			const parent = cache.elements.find(
				(candidate) =>
					candidate.key === key && candidate.windowKey === windowKey,
			);
			return parent ? [parent] : [];
		}),
	].flatMap((candidate) => {
		const imageRect = annotationAxRectToImage(candidate.frame, geometry);
		const viewportRect =
			imageRect && annotationImageRectToViewport(imageRect, geometry);
		return imageRect && viewportRect
			? [
					{
						key: candidate.key,
						element: candidate.element,
						axScreen: cache.snapshot.screen,
						imageRect,
						viewportRect,
					},
				]
			: [];
	});
	return { candidates, reason: candidates.length ? null : "no-target" };
}

/** Cycles only the captured chain. A new tree never supplies a different parent. */
export function cycleAnnotationParent(
	selection: AnnotationElementSelection,
): AnnotationElementSelection {
	const candidateIndex =
		(selection.candidateIndex + 1) % selection.candidates.length;
	const target: AnnotationElementTarget = selection.candidates[candidateIndex]!;
	return copy({ ...selection, ...target, candidateIndex });
}

/** Use before capture. A changed version requires an explicit new selection. */
export function validateAnnotationSelection(
	selection: AnnotationSelection,
	cache: AnnotationSelectionCache | null,
	identity: AnnotationIdentity,
	now: number,
): AnnotationFallbackReason | null {
	const identityReason = identityFailure(
		selection.identity,
		identity,
		selection.kind === "element",
	);
	if (identityReason) return identityReason;
	if (selection.kind === "region") return null;
	const failure = annotationCacheFailure(cache, identity, now);
	if (failure) return failure;
	return selection.metadata.revision === cache!.metadata.revision
		? null
		: "revision-changed";
}
