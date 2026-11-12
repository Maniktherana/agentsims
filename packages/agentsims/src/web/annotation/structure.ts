import { CONTEXT_LIMITS } from "../../core/tools/context/contracts";
import type {
	ContextNode,
	ContextNodeList,
	ContextStructure,
} from "../../core/tools/context/contracts";
import type {
	AxElement,
	AxRect,
} from "../../core/tools/observe/accessibility-model";
import type {
	AnnotationCachedElement,
	AnnotationSpatialSnapshot,
} from "./contracts";

const DIRECT_SOURCE = new Set(["test-id", "native-id", "element-id"]);

function text(value: string | undefined): string | undefined {
	const result = value?.replace(/\s+/g, " ").trim();
	if (!result) return undefined;
	const limit = CONTEXT_LIMITS.structureText;
	return result.length > limit ? `${result.slice(0, limit - 1)}…` : result;
}

function sourceKey(element: AxElement): string | undefined {
	const source = element.source;
	if (!source?.file || !source.line) return undefined;
	return `${source.file}:${source.line}${source.column ? `:${source.column}` : ""}`;
}

function describe(element: AxElement): ContextNode {
	const role = text(element.role) ?? text(element.type) ?? "";
	const type = text(element.type);
	const source = sourceKey(element);
	return {
		...(text(element.label) ? { label: text(element.label) } : {}),
		role,
		...(type && type !== role ? { type } : {}),
		...(text(element.testId) ? { testId: text(element.testId) } : {}),
		...(source ? { source: text(source) } : {}),
	};
}

function informative(element: AxElement): boolean {
	return !!(text(element.label) || text(element.testId) || sourceKey(element));
}

function nodeList(
	entries: readonly AnnotationCachedElement[],
): ContextNodeList | undefined {
	if (!entries.length) return undefined;
	return {
		total: entries.length,
		items: entries
			.filter((entry) => informative(entry.element))
			.slice(0, CONTEXT_LIMITS.structureItems)
			.map((entry) => describe(entry.element)),
	};
}

function distance(a: AxRect, b: AxRect): number {
	const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
	const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
	return Math.hypot(dx, dy);
}

function readingOrder(
	a: AnnotationCachedElement,
	b: AnnotationCachedElement,
): number {
	return a.frame.y - b.frame.y || a.frame.x - b.frame.x;
}

/**
 * Describe the structure around a selected element from one cache revision.
 * Ancestors, siblings, and children come only from tree parent links. Bounds
 * only order nearby text and instances; they never create a hierarchy link.
 */
export function annotationTargetStructure(
	cache: AnnotationSpatialSnapshot,
	key: string,
): ContextStructure | undefined {
	const target = cache.elements.find((entry) => entry.key === key);
	if (!target) return undefined;
	const screen = cache.snapshot.screen;
	const screenArea = screen.width * screen.height;
	// A node that fills the screen is a root or backdrop. It names nothing.
	const fillsScreen = (entry: AnnotationCachedElement) =>
		entry.frame.width * entry.frame.height >= screenArea * 0.95;
	const byKey = new Map(cache.elements.map((entry) => [entry.key, entry]));
	const parentKey = target.parentKeys[0];
	const ancestors = target.parentKeys
		.flatMap((parent) => {
			const entry = byKey.get(parent);
			return entry && !fillsScreen(entry) && informative(entry.element)
				? [entry]
				: [];
		})
		.slice(0, CONTEXT_LIMITS.structureItems)
		.map((entry) => describe(entry.element));
	const siblings = parentKey
		? cache.elements.filter(
				(entry) => entry.key !== key && entry.parentKeys[0] === parentKey,
			)
		: [];
	const children = cache.elements.filter(
		(entry) => entry.parentKeys[0] === key,
	);
	const related = new Set([
		key,
		...target.parentKeys,
		...siblings.map((entry) => entry.key),
	]);
	const own = text(target.element.label);
	const listed = new Set(
		[...siblings, ...children].map((entry) => text(entry.element.label)),
	);
	const nearby: string[] = [];
	for (const entry of cache.elements
		.filter(
			(entry) =>
				entry.windowKey === target.windowKey &&
				!related.has(entry.key) &&
				!entry.parentKeys.includes(key) &&
				!fillsScreen(entry),
		)
		.sort(
			(a, b) =>
				distance(a.frame, target.frame) - distance(b.frame, target.frame) ||
				readingOrder(a, b),
		)) {
		const label = text(entry.element.label);
		if (!label || label === own || listed.has(label) || nearby.includes(label))
			continue;
		nearby.push(label);
		if (nearby.length === CONTEXT_LIMITS.nearbyTexts) break;
	}
	const source = target.element.source;
	const sourceIdentity =
		source && (!source.matchReason || DIRECT_SOURCE.has(source.matchReason))
			? sourceKey(target.element)
			: undefined;
	const role = target.element.role || target.element.type;
	const peers = cache.elements
		.filter((entry) => {
			if (entry.windowKey !== target.windowKey) return false;
			if (sourceIdentity) return sourceKey(entry.element) === sourceIdentity;
			return (
				!!own &&
				(entry.element.role || entry.element.type) === role &&
				text(entry.element.label) === own
			);
		})
		.sort(readingOrder);
	const structure: ContextStructure = {
		...(ancestors.length ? { ancestors } : {}),
		...(nodeList(siblings) ? { siblings: nodeList(siblings) } : {}),
		...(nodeList(children) ? { children: nodeList(children) } : {}),
		...(nearby.length ? { nearby } : {}),
		...(peers.length > 1
			? {
					instance: {
						index: peers.indexOf(target) + 1,
						total: peers.length,
						basis: sourceIdentity ? ("source" as const) : ("label" as const),
					},
				}
			: {}),
	};
	return Object.keys(structure).length ? structure : undefined;
}
