export interface ObserveFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ObserveNode {
	type: string;
	label: string;
	frame: ObserveFrame | null;
	children: ObserveNode[];
}

export interface Observation {
	device?: string;
	platform?: string;
	screenshot?: { mimeType?: string; contentBase64?: string; bytes?: number };
	config?: { width?: number; height?: number; orientation?: string };
	accessibility?: unknown;
	warnings?: unknown[];
}

const text = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

function frameOf(raw: Record<string, unknown>): ObserveFrame | null {
	const frame = raw.frame;
	if (!frame || typeof frame !== "object") return null;
	const { x, y, width, height } = frame as Record<string, unknown>;
	return [x, y, width, height].every((v) => typeof v === "number")
		? { x: x as number, y: y as number, width: width as number, height: height as number }
		: null;
}

/** iOS returns a nested tree keyed on AX* fields; Android a flat element list. */
function toNode(raw: Record<string, unknown>): ObserveNode {
	const children = Array.isArray(raw.children)
		? (raw.children as Record<string, unknown>[]).map(toNode)
		: [];
	return {
		type: text(raw.type) || text(raw.role) || text(raw.role_description) || "?",
		label: text(raw.AXLabel) || text(raw.label) || text(raw.AXValue) || text(raw.value),
		frame: frameOf(raw),
		children,
	};
}

/** Android nests its flat element list by dotted `path`; iOS already nests. */
function nestByPath(
	entries: { node: ObserveNode; path: string }[],
): ObserveNode[] {
	const byPath = new Map(entries.map((entry) => [entry.path, entry.node]));
	const roots: ObserveNode[] = [];
	for (const { node, path } of entries) {
		const cut = path.lastIndexOf(".");
		const parent = cut === -1 ? undefined : byPath.get(path.slice(0, cut));
		if (parent && parent !== node) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

export function normalizeAx(accessibility: unknown): ObserveNode[] {
	const elements = (accessibility as { elements?: unknown })?.elements;
	const list = Array.isArray(accessibility)
		? accessibility
		: Array.isArray(elements)
			? elements
			: [];
	const raws = (list as Record<string, unknown>[]).filter(
		(raw) => raw && typeof raw === "object",
	);
	const nodes = raws.map(toNode);
	return raws.every((raw) => typeof raw.path === "string")
		? nestByPath(
				raws.map((raw, index) => ({
					node: nodes[index]!,
					path: raw.path as string,
				})),
			)
		: nodes;
}

export function countNodes(nodes: readonly ObserveNode[]): number {
	return nodes.reduce((total, node) => total + 1 + countNodes(node.children), 0);
}

/**
 * Accessibility frames are in the tree's own space (iOS points, Android
 * pixels), which is not always the screenshot's. `tap` takes 0-1, so emit the
 * normalized centre next to each element and the conversion never comes up.
 */
export function axExtent(nodes: readonly ObserveNode[]): ObserveFrame | null {
	const roots = nodes.map((node) => node.frame).filter((f) => f !== null);
	if (roots.length === 0) return null;
	return roots.reduce((widest, frame) =>
		frame.width * frame.height > widest.width * widest.height ? frame : widest,
	);
}

function tapText(
	frame: ObserveFrame | null,
	extent: ObserveFrame | null,
): string {
	if (!frame || !extent || extent.width <= 0 || extent.height <= 0) return "";
	const x = (frame.x + frame.width / 2) / extent.width;
	const y = (frame.y + frame.height / 2) / extent.height;
	if (x < 0 || x > 1 || y < 0 || y > 1) return "";
	return `  tap ${x.toFixed(3)},${y.toFixed(3)}`;
}

export function renderAx(nodes: readonly ObserveNode[], limit = 200): string[] {
	const extent = axExtent(nodes);
	const lines: string[] = [];
	const walk = (list: readonly ObserveNode[], depth: number) => {
		for (const node of list) {
			if (lines.length >= limit) return;
			const label = node.label ? `  "${node.label}"` : "";
			lines.push(
				`${"  ".repeat(depth)}${node.type}${label}${tapText(node.frame, extent)}`.trimEnd(),
			);
			walk(node.children, depth + 1);
		}
	};
	walk(nodes, 0);
	return lines;
}

export function screenshotExtension(mimeType: string | undefined): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	return "png";
}

export function observationFileName(
	device: string,
	mimeType: string | undefined,
	now: Date,
): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const safe = device.replace(/[^0-9A-Za-z._-]/g, "_");
	return `observe-${safe}-${stamp}.${screenshotExtension(mimeType)}`;
}

export function renderObservation(
	observation: Observation,
	screenshotPath: string | null,
): string {
	const nodes = normalizeAx(observation.accessibility);
	const config = observation.config ?? {};
	const size =
		typeof config.width === "number" && typeof config.height === "number"
			? `${config.width}×${config.height}${config.orientation ? ` ${config.orientation}` : ""}`
			: "";
	const rows: string[] = [];
	if (screenshotPath) rows.push(`screen    ${screenshotPath}${size ? `  ${size}` : ""}`);
	else if (size) rows.push(`screen    ${size}`);
	if (nodes.length > 0) {
		const total = countNodes(nodes);
		const lines = renderAx(nodes);
		rows.push(`elements  ${total}`);
		rows.push("");
		rows.push(...lines);
		if (lines.length < total)
			rows.push(`… ${total - lines.length} more (use --json for all)`);
	} else {
		rows.push("elements  none (accessibility not captured)");
	}
	for (const warning of observation.warnings ?? [])
		rows.push(`warning   ${typeof warning === "string" ? warning : JSON.stringify(warning)}`);
	return rows.join("\n");
}

export interface StoredShot {
	name: string;
	modifiedMs: number;
}

/** Keep the screenshot directory bounded: recent enough, and not too many. */
export const SHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SHOT_MAX_COUNT = 40;

export function shotsToPrune(
	shots: readonly StoredShot[],
	nowMs: number,
	maxAgeMs = SHOT_MAX_AGE_MS,
	maxCount = SHOT_MAX_COUNT,
): string[] {
	const newestFirst = [...shots].sort((a, b) => b.modifiedMs - a.modifiedMs);
	return newestFirst
		.filter(
			(shot, index) =>
				index >= maxCount || nowMs - shot.modifiedMs > maxAgeMs,
		)
		.map((shot) => shot.name);
}
