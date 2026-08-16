import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { AxElement, AxSnapshot, AxSourceContext } from "./model";

export const DEFAULT_RN_SOURCE_MANIFEST = join(
	homedir(),
	".agentsims",
	"rn-source-map.jsonl",
);

export interface RnSourceManifestEntry {
	testID: string;
	tag: string;
	elementKind?: "host" | "custom";
	file?: string;
	absoluteFile?: string;
	line?: number;
	column?: number;
	componentName?: string;
	ownerStack?: string[];
	route?: string;
	visibleText?: string;
	props?: Record<string, string | number | boolean | null>;
	injected?: boolean;
}

interface SourceRegistry {
	byTestID: Map<string, RnSourceManifestEntry[]>;
}

export interface RnSourceFile {
	file: string;
	line: number;
	startLine: number;
	lines: string[];
	/** Stable across reads until the approved source file changes on disk. */
	cacheKey: string;
}

export const MAX_RN_SOURCE_FILE_BYTES = 2 * 1024 * 1024;

interface IdentifierCandidate {
	value: string;
	confidence: "exact-testid" | "native-id";
	reason: "test-id" | "native-id" | "element-id";
	priority: number;
}

interface DirectSourceMatch {
	entry: RnSourceManifestEntry;
	ownerKey: string;
	source: AxSourceContext;
}

interface DirectSourceResult {
	match: DirectSourceMatch | null;
	ambiguous: boolean;
}

let cache: {
	path: string;
	size: number;
	mtimeMs: number;
	registry: SourceRegistry;
} | null = null;

const sourceFileCache = new Map<
	string,
	{ size: number; mtimeMs: number; source: RnSourceFile }
>();

export function rnSourceManifestPath(): string {
	return process.env.AGENTSIMS_RN_MANIFEST || DEFAULT_RN_SOURCE_MANIFEST;
}

function normalizeIdentifier(value: string | undefined | null): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (!trimmed) return [];
	const out = new Set<string>([trimmed]);
	const slash = trimmed.lastIndexOf("/");
	if (slash >= 0 && slash < trimmed.length - 1)
		out.add(trimmed.slice(slash + 1));
	const colon = trimmed.lastIndexOf(":");
	if (colon >= 0 && colon < trimmed.length - 1)
		out.add(trimmed.slice(colon + 1));
	return [...out];
}

function sourceOwnerKey(entry: RnSourceManifestEntry): string {
	return JSON.stringify([
		entry.absoluteFile || entry.file || null,
		entry.line ?? null,
		entry.column ?? null,
		entry.tag,
		entry.elementKind || null,
		entry.componentName || null,
		entry.route || null,
	]);
}

function loadRegistry(path = rnSourceManifestPath()): SourceRegistry {
	try {
		if (!existsSync(path)) return { byTestID: new Map() };
		const stat = statSync(path);
		if (
			cache &&
			cache.path === path &&
			cache.size === stat.size &&
			cache.mtimeMs === stat.mtimeMs
		) {
			return cache.registry;
		}

		const byTestID = new Map<string, RnSourceManifestEntry[]>();
		const text = readFileSync(path, "utf-8");
		for (const line of text.split(/\r?\n/)) {
			if (!line.trim()) continue;
			try {
				const entry = JSON.parse(line) as RnSourceManifestEntry;
				if (!entry.testID) continue;
				const entries = byTestID.get(entry.testID) ?? [];
				const ownerKey = sourceOwnerKey(entry);
				const previous = entries.findIndex(
					(candidate) => sourceOwnerKey(candidate) === ownerKey,
				);
				if (previous >= 0) entries[previous] = entry;
				else entries.push(entry);
				byTestID.set(entry.testID, entries);
			} catch (error) {
				console.warn(
					"[agentsims:accessibility] recoverable operation failed",
					error,
				);
			}
		}
		const registry = { byTestID };
		cache = { path, size: stat.size, mtimeMs: stat.mtimeMs, registry };
		return registry;
	} catch {
		return { byTestID: new Map() };
	}
}

export function readRnSourceFile({
	testID,
	file,
	line,
}: {
	testID: string;
	file: string;
	line: number;
}): RnSourceFile | null {
	const entries = loadRegistry().byTestID.get(testID) ?? [];
	const entry = entries.find(
		(candidate) =>
			(candidate.absoluteFile === file || candidate.file === file) &&
			candidate.line === line,
	);
	const absoluteFile = entry?.absoluteFile;
	if (!entry || !absoluteFile || !existsSync(absoluteFile)) return null;

	try {
		const stat = statSync(absoluteFile);
		if (
			!stat.isFile() ||
			stat.size <= 0 ||
			stat.size > MAX_RN_SOURCE_FILE_BYTES
		) {
			return null;
		}
		const cached = sourceFileCache.get(absoluteFile);
		if (
			cached &&
			cached.size === stat.size &&
			cached.mtimeMs === stat.mtimeMs
		) {
			return cached.source;
		}
		const sourceLines = readFileSync(absoluteFile, "utf-8").split(/\r?\n/);
		if (!sourceLines.some((sourceLine) => sourceLine.trim().length > 0)) {
			return null;
		}
		const source: RnSourceFile = {
			file: entry.file || absoluteFile,
			line,
			startLine: 1,
			lines: sourceLines,
			cacheKey: `${stat.mtimeMs}:${stat.size}:${entry.file || absoluteFile}`,
		};
		sourceFileCache.set(absoluteFile, {
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			source,
		});
		return source;
	} catch {
		return null;
	}
}

/** @deprecated Kept for integrations compiled against the earlier API name. */
export const readRnSourceExcerpt = readRnSourceFile;

function identifierCandidates(element: AxElement): IdentifierCandidate[] {
	const candidates = new Map<string, IdentifierCandidate>();
	const add = (
		value: string | undefined,
		field: "test-id" | "native-id" | "element-id",
	) => {
		const trimmed = value?.trim();
		if (!trimmed) return;
		for (const normalized of normalizeIdentifier(trimmed)) {
			const rawExact = normalized === trimmed;
			const candidate: IdentifierCandidate = {
				value: normalized,
				confidence:
					rawExact && (field === "test-id" || field === "element-id")
						? "exact-testid"
						: "native-id",
				reason: rawExact ? field : "native-id",
				priority:
					rawExact && field === "test-id"
						? 3
						: rawExact && field === "element-id"
							? 2
							: 1,
			};
			const previous = candidates.get(normalized);
			if (!previous || candidate.priority > previous.priority) {
				candidates.set(normalized, candidate);
			}
		}
	};

	add(element.testId, "test-id");
	add(element.nativeId, "native-id");
	add(element.id, "element-id");
	return [...candidates.values()];
}

function sourceFromEntry(
	entry: RnSourceManifestEntry,
	confidence: AxSourceContext["confidence"],
	matchReason: NonNullable<AxSourceContext["matchReason"]>,
): AxSourceContext {
	return {
		kind: "react-native",
		confidence,
		matchReason,
		elementKind: entry.elementKind,
		testID: entry.testID,
		componentName: entry.componentName,
		ownerStack: entry.ownerStack,
		elementName: entry.tag,
		file: entry.file,
		absoluteFile: entry.absoluteFile,
		line: entry.line,
		column: entry.column,
		route: entry.route,
		visibleText: entry.visibleText,
		props: entry.props,
		injected: entry.injected,
	};
}

function directSourceForElement(
	element: AxElement,
	registry: SourceRegistry,
): DirectSourceResult {
	const matches: Array<DirectSourceMatch & { priority: number }> = [];
	let ambiguous = false;

	for (const candidate of identifierCandidates(element)) {
		const entries = registry.byTestID.get(candidate.value);
		if (!entries) continue;
		if (entries.length !== 1) {
			ambiguous = true;
			continue;
		}
		const entry = entries[0]!;
		matches.push({
			entry,
			ownerKey: sourceOwnerKey(entry),
			source: sourceFromEntry(entry, candidate.confidence, candidate.reason),
			priority: candidate.priority,
		});
	}

	const owners = new Set(matches.map((match) => match.ownerKey));
	if (ambiguous || owners.size > 1) return { match: null, ambiguous: true };
	const best = matches.sort((left, right) => right.priority - left.priority)[0];
	if (!best) return { match: null, ambiguous: false };
	return {
		match: {
			entry: best.entry,
			ownerKey: best.ownerKey,
			source: best.source,
		},
		ambiguous: false,
	};
}

function normalizedText(value: unknown): string {
	return typeof value === "string"
		? value.trim().replace(/\s+/g, " ").toLowerCase()
		: "";
}

function elementTexts(element: AxElement): Set<string> {
	return new Set(
		[normalizedText(element.label), normalizedText(element.value)].filter(
			Boolean,
		),
	);
}

function rectArea(element: AxElement): number {
	return Math.max(0, element.frame.width) * Math.max(0, element.frame.height);
}

function frameContains(container: AxElement, target: AxElement): boolean {
	const tolerance = 2;
	const outer = container.frame;
	const inner = target.frame;
	return (
		inner.x >= outer.x - tolerance &&
		inner.y >= outer.y - tolerance &&
		inner.x + inner.width <= outer.x + outer.width + tolerance &&
		inner.y + inner.height <= outer.y + outer.height + tolerance
	);
}

function framesNearlyEqual(left: AxElement, right: AxElement): boolean {
	return (
		Math.abs(left.frame.x - right.frame.x) <= 2 &&
		Math.abs(left.frame.y - right.frame.y) <= 2 &&
		Math.abs(left.frame.width - right.frame.width) <= 3 &&
		Math.abs(left.frame.height - right.frame.height) <= 3
	);
}

function hierarchicalPathParts(path: string): string[] | null {
	if (/^\d+$/.test(path)) return null;
	const parts = path.split(/[./>]+/).filter(Boolean);
	return parts.length > 1 ? parts : null;
}

function isHierarchicalAncestor(
	parentPath: string,
	childPath: string,
): boolean {
	const parent = hierarchicalPathParts(parentPath);
	const child = hierarchicalPathParts(childPath);
	if (!parent || !child || parent.length >= child.length) return false;
	return parent.every((part, index) => child[index] === part);
}

function isNearbyPreorderNode(
	carrier: AxElement,
	carrierIndex: number,
	target: AxElement,
	targetIndex: number,
): boolean {
	if (isHierarchicalAncestor(carrier.path, target.path)) return true;
	// Android UIAutomator paths are flattened preorder indices. Keep its
	// geometric fallback local so a large earlier container cannot claim a leaf.
	if (targetIndex <= carrierIndex || targetIndex - carrierIndex > 8)
		return false;

	const carrierPath = Number(carrier.path);
	const targetPath = Number(target.path);
	if (Number.isInteger(carrierPath) && Number.isInteger(targetPath)) {
		return targetPath > carrierPath && targetPath - carrierPath <= 8;
	}
	return true;
}

function nearestAncestorSourceForElement(
	target: AxElement,
	elements: AxElement[],
	directResults: DirectSourceResult[],
): AxSourceContext | null {
	const targetParts = hierarchicalPathParts(target.path);
	if (!targetParts) return null;

	const candidates: Array<DirectSourceMatch & { depth: number }> = [];
	for (let index = 0; index < elements.length; index++) {
		const direct = directResults[index]?.match;
		if (!direct) continue;
		const carrier = elements[index]!;
		if (
			direct.entry.injected !== true &&
			!/^ags_[a-z0-9_-]+$/i.test(direct.entry.testID)
		) {
			continue;
		}
		const carrierParts = hierarchicalPathParts(carrier.path);
		if (
			!carrierParts ||
			carrierParts.length >= targetParts.length ||
			!carrierParts.every((part, partIndex) => targetParts[partIndex] === part)
		) {
			continue;
		}
		candidates.push({ ...direct, depth: carrierParts.length });
	}

	if (candidates.length === 0) return null;
	const nearestDepth = Math.max(
		...candidates.map((candidate) => candidate.depth),
	);
	const nearest = candidates.filter(
		(candidate) => candidate.depth === nearestDepth,
	);
	const owners = new Set(nearest.map((candidate) => candidate.ownerKey));
	if (owners.size !== 1) return null;
	return sourceFromEntry(
		nearest[0]!.entry,
		"related-native-id",
		"ancestor-owner",
	);
}

function nativeHostMatches(
	entry: RnSourceManifestEntry,
	element: AxElement,
): boolean {
	const tag = entry.tag.split(".").at(-1);
	const nativeType = `${element.role} ${element.type}`.toLowerCase();
	switch (tag) {
		case "TextInput":
			return nativeType.includes("edittext");
		case "Text":
			return nativeType.includes("textview");
		case "Image":
		case "ImageBackground":
			return nativeType.includes("imageview");
		case "Switch":
			return nativeType.includes("switch");
		case "ActivityIndicator":
			return nativeType.includes("progressbar");
		case "Button":
			return nativeType.includes("button");
		case "ScrollView":
		case "FlatList":
		case "SectionList":
		case "VirtualizedList":
			return nativeType.includes("scrollview");
		default:
			return false;
	}
}

interface RelatedEvidence {
	reason:
		| "nearby-visible-text"
		| "nearby-accessibility-label"
		| "nearby-placeholder"
		| "nearby-carrier-text"
		| "nearby-host-type";
	strength: number;
}

function relatedEvidence(
	entry: RnSourceManifestEntry,
	carrier: AxElement,
	target: AxElement,
): RelatedEvidence | null {
	const targetTexts = elementTexts(target);
	if (targetTexts.size > 0) {
		if (targetTexts.has(normalizedText(entry.visibleText))) {
			return { reason: "nearby-visible-text", strength: 5 };
		}
		if (targetTexts.has(normalizedText(entry.props?.accessibilityLabel))) {
			return { reason: "nearby-accessibility-label", strength: 5 };
		}
		if (targetTexts.has(normalizedText(entry.props?.placeholder))) {
			return { reason: "nearby-placeholder", strength: 5 };
		}
		const carrierTexts = elementTexts(carrier);
		if ([...targetTexts].some((text) => carrierTexts.has(text))) {
			return { reason: "nearby-carrier-text", strength: 4 };
		}
	}

	const areaRatio =
		rectArea(target) > 0 ? rectArea(carrier) / rectArea(target) : Infinity;
	if (
		nativeHostMatches(entry, target) &&
		(framesNearlyEqual(carrier, target) || areaRatio <= 1.2)
	) {
		return { reason: "nearby-host-type", strength: 3 };
	}
	return null;
}

function relatedSourceForElement(
	target: AxElement,
	targetIndex: number,
	elements: AxElement[],
	directResults: DirectSourceResult[],
): AxSourceContext | null {
	const ancestorSource = nearestAncestorSourceForElement(
		target,
		elements,
		directResults,
	);
	if (ancestorSource) return ancestorSource;

	const candidates: Array<{
		direct: DirectSourceMatch;
		evidence: RelatedEvidence;
		carrierArea: number;
	}> = [];

	for (let carrierIndex = 0; carrierIndex < elements.length; carrierIndex++) {
		const direct = directResults[carrierIndex]?.match;
		if (!direct) continue;
		const carrier = elements[carrierIndex]!;
		if (
			direct.entry.injected !== true &&
			!/^ags_[a-z0-9_-]+$/i.test(direct.entry.testID)
		) {
			continue;
		}
		if (!isNearbyPreorderNode(carrier, carrierIndex, target, targetIndex))
			continue;
		if (!frameContains(carrier, target)) continue;
		const evidence = relatedEvidence(direct.entry, carrier, target);
		if (!evidence) continue;
		candidates.push({
			direct,
			evidence,
			carrierArea: rectArea(carrier),
		});
	}

	if (candidates.length === 0) return null;
	const strongest = Math.max(
		...candidates.map((candidate) => candidate.evidence.strength),
	);
	const strongestCandidates = candidates.filter(
		(candidate) => candidate.evidence.strength === strongest,
	);
	const smallestArea = Math.min(
		...strongestCandidates.map((candidate) => candidate.carrierArea),
	);
	const finalists = strongestCandidates.filter(
		(candidate) => Math.abs(candidate.carrierArea - smallestArea) <= 1,
	);
	const owners = new Set(
		finalists.map((candidate) => candidate.direct.ownerKey),
	);
	if (owners.size !== 1) return null;

	const winner = finalists[0]!;
	return sourceFromEntry(
		winner.direct.entry,
		"related-native-id",
		winner.evidence.reason,
	);
}

export function enrichAxSnapshotWithRnSource(snapshot: AxSnapshot): AxSnapshot {
	const registry = loadRegistry();
	if (registry.byTestID.size === 0) return snapshot;

	const directResults = snapshot.elements.map((element) =>
		directSourceForElement(element, registry),
	);
	let changed = false;
	const elements = snapshot.elements.map((element, index) => {
		if (element.source) return element;
		const direct = directResults[index]!;
		const source =
			direct.match?.source ??
			(!direct.ambiguous
				? relatedSourceForElement(
						element,
						index,
						snapshot.elements,
						directResults,
					)
				: null);
		if (!source) return element;
		changed = true;
		return { ...element, source };
	});
	return changed ? { ...snapshot, elements } : snapshot;
}
