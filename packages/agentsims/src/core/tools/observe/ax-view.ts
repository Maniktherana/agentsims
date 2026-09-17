import type { AxElement, AxRect, AxSnapshot } from "./accessibility-model";

export const AX_ROLES = [
	"button",
	"textbox",
	"securetextbox",
	"checkbox",
	"switch",
	"link",
	"cell",
	"list",
	"scrollview",
	"image",
	"text",
	"tab",
	"slider",
	"combobox",
	"alert",
	"dialog",
	"webview",
	"generic",
] as const;
export type AxRole = (typeof AX_ROLES)[number];

const INTERACTIVE_ROLES: ReadonlySet<string> = new Set<AxRole>([
	"button",
	"textbox",
	"securetextbox",
	"checkbox",
	"switch",
	"link",
	"cell",
	"tab",
	"slider",
	"combobox",
]);

export const AX_STATES = [
	"focused",
	"disabled",
	"checked",
	"unchecked",
	"selected",
	"scrollable",
	"long-press",
	"offscreen",
] as const;
export type AxState = (typeof AX_STATES)[number];

export interface AxViewNode {
	ref: string;
	id: string;
	/** The node path in the platform tree. The device acts on this node. */
	path: string;
	windowId?: number;
	sourceId?: number;
	role: AxRole;
	rawRole: string;
	label: string;
	value: string;
	testId?: string;
	states: AxState[];
	/** Element bounds in screenshot pixels. */
	box: AxRect;
	/** Element centre as a 0-1 fraction of the screen, the input frame unit. */
	point: { x: number; y: number };
	children: AxViewNode[];
}

const ANDROID_ROLES: ReadonlyArray<readonly [RegExp, AxRole]> = [
	[/AlertDialog/, "dialog"],
	[/EditText|AutoCompleteTextView|SearchView/, "textbox"],
	[/Switch|ToggleButton/, "switch"],
	[/CheckBox|RadioButton|CheckedTextView/, "checkbox"],
	[/SeekBar|RatingBar/, "slider"],
	[/Spinner/, "combobox"],
	[/Button|Chip/, "button"],
	[/WebView/, "webview"],
	[/ImageView|ImageSwitcher/, "image"],
	[/RecyclerView|ListView|GridView/, "list"],
	[/ScrollView|ViewPager/, "scrollview"],
	[/TabWidget|TabLayout/, "tab"],
	[/TextView/, "text"],
];

const IOS_ROLES: Readonly<Record<string, AxRole>> = {
	button: "button",
	menubutton: "button",
	popupbutton: "combobox",
	combobox: "combobox",
	textfield: "textbox",
	searchfield: "textbox",
	textarea: "textbox",
	securetextfield: "securetextbox",
	checkbox: "checkbox",
	switch: "switch",
	toggle: "switch",
	radiobutton: "checkbox",
	link: "link",
	cell: "cell",
	row: "cell",
	table: "list",
	list: "list",
	outline: "list",
	scrollarea: "scrollview",
	image: "image",
	statictext: "text",
	text: "text",
	tab: "tab",
	tabgroup: "tab",
	slider: "slider",
	incrementor: "slider",
	sheet: "dialog",
	dialog: "dialog",
	alert: "alert",
	webarea: "webview",
};

export type AxPlatform = "ios" | "android";

function hasTrait(element: AxElement, trait: string): boolean {
	return element.traits?.includes(trait) === true;
}

export function axRoleOf(element: AxElement, platform: AxPlatform): AxRole {
	const raw = element.type || element.role || "";
	if (platform === "android") {
		if (hasTrait(element, "password")) return "securetextbox";
		if (hasTrait(element, "editable")) return "textbox";
		for (const [pattern, role] of ANDROID_ROLES)
			if (pattern.test(raw)) return role;
		return "generic";
	}
	return IOS_ROLES[raw.toLowerCase()] ?? "generic";
}

export function axStatesOf(element: AxElement): AxState[] {
	const states: AxState[] = [];
	if (hasTrait(element, "focused")) states.push("focused");
	if (element.enabled === false) states.push("disabled");
	if (hasTrait(element, "checked")) states.push("checked");
	else if (hasTrait(element, "checkable")) states.push("unchecked");
	if (hasTrait(element, "selected")) states.push("selected");
	if (hasTrait(element, "scrollable")) states.push("scrollable");
	if (hasTrait(element, "long press")) states.push("long-press");
	if (element.visibleToUser === false) states.push("offscreen");
	return states;
}

interface TreeNode {
	element: AxElement;
	role: AxRole;
	states: AxState[];
	label: string;
	value: string;
	children: TreeNode[];
}

/** Both collectors report a flat list keyed by a dotted path. Rebuild the tree. */
function nestElements(
	elements: readonly AxElement[],
	platform: AxPlatform,
): TreeNode[] {
	const byPath = new Map<string, TreeNode>();
	const roots: TreeNode[] = [];
	for (const element of elements) {
		const label = element.label.trim();
		const role = axRoleOf(element, platform);
		const fieldValue =
			role === "textbox" || role === "securetextbox" || role === "combobox";
		const node: TreeNode = {
			element,
			role,
			states: axStatesOf(element),
			label,
			value: fieldValue
				? element.value
				: element.value.trim() === label
					? ""
					: element.value.trim(),
			children: [],
		};
		byPath.set(element.path, node);
		let parent: TreeNode | undefined;
		let path = element.path;
		while (!parent) {
			const cut = path.lastIndexOf(".");
			if (cut === -1) break;
			path = path.slice(0, cut);
			parent = byPath.get(path);
		}
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	return roots;
}

function isNamed(node: TreeNode): boolean {
	return Boolean(node.label || node.value || node.element.testId);
}

/** Rule 1: an actionable node, a named node, or a node the agent can scroll. */
function keepsNode(node: TreeNode): boolean {
	return (
		INTERACTIVE_ROLES.has(node.role) ||
		isNamed(node) ||
		node.states.includes("scrollable") ||
		(node.role === "generic" && hasTrait(node.element, "clickable"))
	);
}

function textOf(node: TreeNode): string {
	return node.label || node.value;
}

function pruneNode(node: TreeNode, parent: TreeNode | null): TreeNode | null {
	const children = node.children
		.map((child) => pruneNode(child, node))
		.filter((child): child is TreeNode => child !== null);
	const duplicate =
		node.role === "text" &&
		parent !== null &&
		textOf(node) !== "" &&
		textOf(node) === textOf(parent);
	const keep = keepsNode(node) && !duplicate;
	if (!keep) {
		if (children.length === 0) return null;
		if (children.length === 1) return children[0]!;
	}
	return { ...node, children };
}

function scaled(value: number, factor: number): number {
	return Math.round(value * factor);
}

export interface AxViewInput {
	snapshot: AxSnapshot;
	platform: AxPlatform;
	/** Screenshot size in pixels. Accessibility frames are scaled into it. */
	screen: { width: number; height: number };
	all: boolean;
	nextRef: () => string;
}

export interface AxViewResult {
	nodes: AxViewNode[];
	shown: number;
	total: number;
	refs: Record<string, string>;
	warnings: string[];
}

export function buildAxView(input: AxViewInput): AxViewResult {
	const axScreen = input.snapshot.screen;
	const scaleX =
		axScreen.width > 0 && input.screen.width > 0
			? input.screen.width / axScreen.width
			: 1;
	const scaleY =
		axScreen.height > 0 && input.screen.height > 0
			? input.screen.height / axScreen.height
			: 1;
	const roots = nestElements(input.snapshot.elements, input.platform);
	const kept = input.all
		? roots
		: roots
				.map((node) => pruneNode(node, null))
				.filter((node): node is TreeNode => node !== null);
	const refs: Record<string, string> = {};
	let shown = 0;
	const toView = (node: TreeNode): AxViewNode => {
		const ref = input.nextRef();
		refs[ref] = node.element.id;
		shown += 1;
		const frame = node.element.frame;
		return {
			ref,
			id: node.element.id,
			path: node.element.path,
			...(node.element.windowId === undefined
				? {}
				: { windowId: node.element.windowId }),
			...(node.element.sourceId === undefined
				? {}
				: { sourceId: node.element.sourceId }),
			role: node.role,
			rawRole: node.element.type || node.element.role,
			label: node.label,
			value: node.value,
			...(node.element.testId ? { testId: node.element.testId } : {}),
			states: node.states,
			box: {
				x: scaled(frame.x, scaleX),
				y: scaled(frame.y, scaleY),
				width: scaled(frame.width, scaleX),
				height: scaled(frame.height, scaleY),
			},
			point: {
				x: axScreen.width > 0 ? (frame.x + frame.width / 2) / axScreen.width : 0,
				y:
					axScreen.height > 0
						? (frame.y + frame.height / 2) / axScreen.height
						: 0,
			},
			children: node.children.map(toView),
		};
	};
	const nodes = kept.map(toView);
	return {
		nodes,
		shown,
		total: input.snapshot.elements.length,
		refs,
		warnings: [...(input.snapshot.errors ?? [])],
	};
}

export function flattenAxView(nodes: readonly AxViewNode[]): AxViewNode[] {
	return nodes.flatMap((node) => [node, ...flattenAxView(node.children)]);
}
