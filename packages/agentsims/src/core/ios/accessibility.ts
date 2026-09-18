import type {
	AxElement,
	AxRect,
	AxSnapshot,
} from "../tools/observe/accessibility-model";
import type { DeviceField } from "../tools/text-input";

interface RawAxeNode {
	AXUniqueId: string | null;
	AXLabel: string | null;
	AXValue: string | null;
	enabled: boolean;
	frame: AxRect;
	role_description: string;
	type: string;
	children: unknown[];
	focused?: boolean;
	selection?: { start: number; end: number };
	AXSelected?: boolean;
	AXPlaceholder?: string | null;
	AXHelp?: string | null;
	AXSubrole?: string | null;
	AXMinValue?: number | null;
	AXMaxValue?: number | null;
	AXNumberValue?: number | null;
}

/** The attributes beyond name and value that the bridge reports. */
function iosDetails(node: RawAxeNode): Partial<AxElement> {
	const details: Partial<AxElement> = {};
	const traits: string[] = [];
	if (node.focused === true) traits.push("focused");
	if (node.AXSelected === true) traits.push("selected");
	if (traits.length > 0) details.traits = traits;
	if (node.AXPlaceholder) details.placeholder = node.AXPlaceholder;
	if (node.AXHelp) details.hint = node.AXHelp;
	if (node.AXSubrole) details.subrole = node.AXSubrole;
	if (
		typeof node.AXMinValue === "number" &&
		typeof node.AXMaxValue === "number" &&
		typeof node.AXNumberValue === "number"
	)
		details.range = {
			current: node.AXNumberValue,
			min: node.AXMinValue,
			max: node.AXMaxValue,
		};
	if (node.selection) details.selection = node.selection;
	return details;
}

function rawAxeNode(value: unknown): RawAxeNode | null {
	if (value === null || typeof value !== "object") return null;
	const frame = (value as Partial<RawAxeNode>).frame;
	if (
		frame === null ||
		typeof frame !== "object" ||
		typeof frame.x !== "number" ||
		typeof frame.y !== "number" ||
		typeof frame.width !== "number" ||
		typeof frame.height !== "number"
	)
		return null;
	return value as RawAxeNode;
}

function chooseScreenFrame(roots: unknown[]) {
	for (const root of roots) {
		const node = rawAxeNode(root);
		if (node) return node.frame;
	}
	return { x: 0, y: 0, width: 1, height: 1 };
}

interface RawNodeEntry {
	node: RawAxeNode;
	path: string;
	identity: string;
}

function nodeIdentity(node: RawAxeNode): string {
	if (node.AXUniqueId) return node.AXUniqueId;
	const { x, y, width, height } = node.frame;
	return JSON.stringify([
		"ios-ax",
		node.type,
		node.role_description,
		node.AXLabel ?? "",
		x,
		y,
		width,
		height,
	]);
}

function rawNodes(roots: unknown[]): RawNodeEntry[] {
	const entries: RawNodeEntry[] = [];
	const visited = new Set<object>();
	const visit = (value: unknown, path: string): void => {
		const node = rawAxeNode(value);
		if (!node || visited.has(node)) return;
		visited.add(node);
		entries.push({ node, path, identity: nodeIdentity(node) });
		const children = Array.isArray(node.children) ? node.children : [];
		for (let index = 0; index < children.length; index++)
			visit(children[index], `${path}.${index}`);
	};
	for (let index = 0; index < roots.length; index++)
		visit(roots[index], String(index));
	return entries;
}

function identityCounts(entries: RawNodeEntry[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const entry of entries)
		counts.set(entry.identity, (counts.get(entry.identity) ?? 0) + 1);
	return counts;
}

function normalizeAxTree(roots: unknown[]): AxSnapshot {
	const screen = chooseScreenFrame(roots);
	const entries = rawNodes(roots);
	const counts = identityCounts(entries);
	const elements: AxElement[] = entries.map(({ node, path, identity }) => {
		return {
			id: counts.get(identity) === 1 ? identity : path,
			path,
			label: node.AXLabel ?? node.AXPlaceholder ?? "",
			value: node.AXValue ?? "",
			role: node.role_description,
			type: node.type,
			enabled: node.enabled !== false,
			frame: node.frame,
			testId: node.AXUniqueId ?? undefined,
			nativeId: node.AXUniqueId ?? undefined,
			...iosDetails(node),
		};
	});

	return {
		screen: {
			width: screen.width,
			height: screen.height,
		},
		elements,
	};
}

/** Flatten the raw nested tree from the iOS bridge into the shared shape. */
export function iosAxSnapshot(raw: unknown): AxSnapshot {
	return normalizeAxTree(Array.isArray(raw) ? raw : []);
}

const IOS_TEXT_TYPES = new Set([
	"TextField",
	"SearchField",
	"TextArea",
	"SecureTextField",
	"ComboBox",
]);

/** Return focus only when the native AX bridge identifies one text field. */
export function iosFocusedField(raw: unknown): DeviceField | null {
	const roots = Array.isArray(raw) ? raw : [];
	const entries = rawNodes(roots);
	const focused = entries.filter(
		({ node }) => node.focused === true && IOS_TEXT_TYPES.has(node.type),
	);
	if (focused.length !== 1) return null;

	const { node, identity } = focused[0]!;
	if (identityCounts(entries).get(identity) !== 1) return null;
	const selection = node.selection;
	const validSelection =
		selection &&
		Number.isInteger(selection.start) &&
		Number.isInteger(selection.end) &&
		selection.start >= 0 &&
		selection.end >= selection.start
			? selection
			: undefined;
	return {
		value: node.AXValue ?? "",
		editable: node.enabled !== false,
		password: node.type === "SecureTextField",
		focused: true,
		identity: {
			id: identity,
		},
		...(validSelection ? { selection: validSelection } : {}),
	};
}
