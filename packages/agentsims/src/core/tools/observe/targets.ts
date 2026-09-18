import { z } from "zod";
import { InvalidCommandInput } from "../errors";
import {
	DeviceActionSchema,
	GESTURE_PHASES,
	type DeviceAction,
} from "../input";
import {
	AX_ROLES,
	flattenAxView,
	parentIndexOf,
	type AxRole,
	type AxViewNode,
} from "./ax-view";
import type { AxElement, AxRect } from "./accessibility-model";
import {
	isRefIdentifier,
	type DeviceSnapshot,
	type SnapshotStore,
} from "./snapshot-store";

export const TargetSelectorSchema = z.object({
	target: z.string().min(1),
	capture: z.string().min(1).optional(),
	role: z.enum(AX_ROLES).optional(),
	index: z.number().int().positive().optional(),
});
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;

export const TargetActionSchema = z.discriminatedUnion("type", [
	TargetSelectorSchema.extend({ type: z.literal("tap") }),
	TargetSelectorSchema.extend({
		type: z.literal("long-press"),
		durationMs: z.number().optional(),
	}),
	TargetSelectorSchema.extend({
		type: z.literal("gesture"),
		phase: z.enum(GESTURE_PHASES),
	}),
	TargetSelectorSchema.omit({ target: true }).extend({
		type: z.literal("swipe"),
		from: z.string().min(1),
		to: z.string().min(1),
		durationMs: z.number().optional(),
	}),
]);
export type TargetAction = z.infer<typeof TargetActionSchema>;

export interface ResolvedPoint {
	/** 0-1 screen fraction, the unit the input frames take. */
	x: number;
	y: number;
	pixels?: { x: number; y: number };
	ref?: string;
	role?: AxRole;
	label?: string;
	capture?: string;
	orientation?: string;
}

export interface ResolvedAction {
	type: DeviceAction["type"];
	from?: ResolvedPoint;
	to?: ResolvedPoint;
	phase?: (typeof GESTURE_PHASES)[number];
	text?: string;
	button?: string;
	orientation?: string;
	key?: string;
	/** The field a type action wrote into, and the value it holds after. */
	into?: ResolvedPoint;
	value?: string | null;
	cleared?: boolean;
	/** Reports a tolerated difference, such as a row that moved. */
	warnings?: string[];
}

export interface ResolvedActions {
	actions: unknown[];
	resolved: ResolvedAction[];
	semanticTargets: Array<{
		action: number;
		endpoint: "from" | "to";
		identity: NodeIdentity;
	}>;
	warnings?: string[];
}

export interface TargetResolutionContext {
	orientation?: string | null;
	generation?: number | null;
	/** The current screen size in pixels. Percent points need no capture. */
	screen?: { width: number; height: number };
}

interface NodeIdentity {
	id: string;
	path: string;
	role: AxRole;
	windowId?: number;
	sourceId?: number;
	/** Kept so a re-rendered row can be found again by what it says. */
	label: string;
	value: string;
	testId?: string;
	box: AxRect;
}

/** A resolved node, and any tolerated difference the agent should read. */
interface TargetCheck {
	node: AxViewNode;
	/** Set when the node carries no actionable role or trait of its own. */
	warning?: string;
}

const POINT_PATTERN = /^(-?\d+(?:\.\d+)?)(%?),(-?\d+(?:\.\d+)?)(%?)$/;

export function isTargetAction(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.target === "string" ||
		typeof record.from === "string" ||
		typeof record.to === "string"
	);
}

export function describeAxNode(node: AxViewNode): string {
	const label = node.label || node.value;
	return `${node.role}${label ? ` "${label}"` : ""} [ref=${node.ref}]`;
}

/**
 * Name a node without a ref. A warning survives the snapshot that its refs
 * belong to, so a ref in a warning is not addressable when the agent reads it.
 */
function namedAxNode(node: AxViewNode): string {
	const label = node.label || node.value;
	const testId = node.testId ? ` [testid=${node.testId}]` : "";
	return `${node.role}${label ? ` "${label}"` : ""}${testId}`;
}

function fail(message: string): never {
	throw new InvalidCommandInput({ message });
}

function requireSnapshot(store: SnapshotStore, device: string): DeviceSnapshot {
	const snapshot = store.current(device);
	if (!snapshot) fail("no snapshot for this device. Run observe");
	return snapshot;
}

function centreOf(box: AxRect): { x: number; y: number } {
	return {
		x: Math.round(box.x + box.width / 2),
		y: Math.round(box.y + box.height / 2),
	};
}

function pointOfNode(node: AxViewNode): ResolvedPoint {
	return {
		x: node.point.x,
		y: node.point.y,
		pixels: centreOf(node.box),
		ref: node.ref,
		role: node.role,
		...(node.label || node.value ? { label: node.label || node.value } : {}),
	};
}

const ACTIONABLE_ROLES: ReadonlySet<AxRole> = new Set([
	"button",
	"textbox",
	"securetextbox",
	"checkbox",
	"switch",
	"link",
	"cell",
	"scrollview",
	"tab",
	"slider",
	"combobox",
]);

function sourceElement(
	store: SnapshotStore,
	device: string,
	node: AxViewNode,
): AxElement | null {
	return (
		store
			.normalized(device)
			?.elements.find((element) => element.path === node.path) ?? null
	);
}

function wrongWindow(
	store: SnapshotStore,
	device: string,
	node: AxViewNode,
): boolean {
	const elements = store.normalized(device)?.elements;
	if (!elements) return false;
	const roots = elements.filter((element) => !element.path.includes("."));
	const rootPath = node.path.split(".")[0]!;
	const targetRoot = roots.find((root) => root.path === rootPath);
	const target = elements.find((element) => element.path === node.path);
	if (!targetRoot || !target) return false;
	const sameWindow = (left: AxElement, right: AxElement): boolean =>
		left.windowId !== undefined && right.windowId !== undefined
			? left.windowId === right.windowId
			: left.path === right.path;
	const active = roots
		.filter(
			(root) => root.windowActive === true || root.windowFocused === true,
		)
		.sort((a, b) => (b.windowLayer ?? 0) - (a.windowLayer ?? 0))[0];
	if (active && !sameWindow(active, targetRoot)) {
		if (
			active.windowLayer === undefined ||
			targetRoot.windowLayer === undefined ||
			targetRoot.windowLayer <= active.windowLayer
		)
			return true;
	}

	const x = target.frame.x + target.frame.width / 2;
	const y = target.frame.y + target.frame.height / 2;
	return roots.some((root) => {
		if (sameWindow(root, targetRoot) || root.visibleToUser === false) return false;
		if (root.windowId === undefined || targetRoot.windowId === undefined)
			return false;
		const frame = root.frame;
		const covers =
			frame.width > 0 &&
			frame.height > 0 &&
			x >= frame.x &&
			x <= frame.x + frame.width &&
			y >= frame.y &&
			y <= frame.y + frame.height;
		if (!covers) return false;
		if (root.windowLayer === undefined || targetRoot.windowLayer === undefined)
			return true;
		return root.windowLayer > targetRoot.windowLayer;
	});
}

/** Report why the node cannot take input, or null when it can. */
function unreachable(
	store: SnapshotStore,
	device: string,
	snapshot: DeviceSnapshot,
	node: AxViewNode,
): string | null {
	if (node.states.includes("disabled"))
		return "is disabled and cannot be targeted";
	if (node.states.includes("offscreen"))
		return "is offscreen. Run observe after it is visible";
	const { x, y, width, height } = node.box;
	if (
		width <= 0 ||
		height <= 0 ||
		x < 0 ||
		y < 0 ||
		x + width > snapshot.screen.width ||
		y + height > snapshot.screen.height
	)
		return "is clipped outside the current screen";
	if (wrongWindow(store, device, node)) return "is behind the active window";
	return null;
}

function isActionable(
	store: SnapshotStore,
	device: string,
	node: AxViewNode,
): boolean {
	const source = sourceElement(store, device, node);
	return (
		ACTIONABLE_ROLES.has(node.role) ||
		source?.traits?.includes("clickable") === true ||
		source?.traits?.includes("scrollable") === true ||
		source?.traits?.includes("long press") === true
	);
}

/** Name the container the agent should have addressed, when there is one. */
function actionableAncestor(
	store: SnapshotStore,
	device: string,
	snapshot: DeviceSnapshot,
	node: AxViewNode,
): AxViewNode | null {
	const parents = parentIndexOf(snapshot.nodes);
	let current = parents.get(node) ?? null;
	while (current) {
		if (
			node.windowId !== undefined &&
			current.windowId !== undefined &&
			current.windowId !== node.windowId
		)
			return null;
		if (
			isActionable(store, device, current) &&
			unreachable(store, device, snapshot, current) === null
		)
			return current;
		current = parents.get(current) ?? null;
	}
	return null;
}

/**
 * Check that the node can take input. An inert node still takes a touch,
 * because the platform delivers it to the view under the point. Report the
 * missing trait as a warning so the agent can read what it hit.
 */
function requireActionable(
	store: SnapshotStore,
	device: string,
	snapshot: DeviceSnapshot,
	node: AxViewNode,
): TargetCheck {
	const description = describeAxNode(node);
	const blocked = unreachable(store, device, snapshot, node);
	if (blocked) fail(`${description} ${blocked}`);
	if (isActionable(store, device, node)) return { node };
	const ancestor = actionableAncestor(store, device, snapshot, node);
	const trait = `${namedAxNode(node)} has no clickable or long-press trait.`;
	return {
		node,
		warning: ancestor
			? `${trait} Its clickable container is ${namedAxNode(ancestor)}`
			: trait,
	};
}

function resolveRef(
	store: SnapshotStore,
	device: string,
	target: string,
): TargetCheck {
	const result = store.resolveRef(device, target);
	if (result.ok)
		return requireActionable(
			store,
			device,
			result.observation,
			result.node,
		);
	const ref = target.startsWith("@") ? target : `@${target}`;
	switch (result.reason) {
		case "invalid":
			fail(`ref ${ref} is invalid. Run observe`);
		case "wrong_device":
			fail(`ref ${ref} belongs to another device. Run observe`);
		case "unknown":
			fail(
				`ref ${ref} is not addressable in snapshot ${result.current?.id ?? "none"}. Run observe`,
			);
	}
}

function isRefTarget(target: string): boolean {
	return target.startsWith("@") || isRefIdentifier(target);
}

function resolvePoint(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
	context: TargetResolutionContext,
): ResolvedPoint | null {
	const target = selector.target;
	const match = POINT_PATTERN.exec(target.replace(/\s+/g, ""));
	if (!match) return null;
	const [, rawX, unitX, rawY, unitY] = match;
	if (unitX !== unitY)
		fail(
			`point "${target}" mixes units. Give both values in pixels, or both in percent`,
		);
	const x = Number(rawX);
	const y = Number(rawY);
	const isPercent = unitX === "%";
	if (isPercent && (x < 0 || x > 100 || y < 0 || y > 100))
		fail(`point "${target}" is outside the screen. Percent runs from 0 to 100`);
	if (!selector.capture) {
		// Percent needs no screenshot. It only needs the live screen size.
		if (!isPercent || !context.screen)
			fail(`point "${target}" requires a current capture ID`);
		const screen = context.screen;
		if (screen.width <= 0 || screen.height <= 0)
			fail(`point "${target}" requires a current capture ID`);
		return {
			x: x / 100,
			y: y / 100,
			pixels: {
				x: Math.round((x / 100) * screen.width),
				y: Math.round((y / 100) * screen.height),
			},
			...(context.orientation ? { orientation: context.orientation } : {}),
		};
	}
	const resolved = store.resolveCapture(device, selector.capture);
	if (!resolved.ok) {
		switch (resolved.reason) {
			case "invalid":
				fail(`capture ${selector.capture} is invalid. Take a screenshot again`);
			case "unknown":
				fail(`capture ${selector.capture} does not exist. Take a screenshot again`);
			case "wrong_device":
				fail(`capture ${selector.capture} belongs to another device`);
			case "unpublished":
				fail(`capture ${selector.capture} is not published`);
			case "failed":
				fail(`capture ${selector.capture} failed and cannot be targeted`);
			case "stale":
				fail(`capture ${selector.capture} is from before the last input. Take a screenshot again`);
		}
	}
	const capture = resolved.capture;
	if (!capture.orientation)
		fail(`capture ${capture.id} has no orientation. Take a screenshot again`);
	if (!context.orientation)
		fail("the current screen orientation is unknown. Take a screenshot again");
	if (capture.orientation !== context.orientation)
		fail(
			`capture ${capture.id} has orientation ${capture.orientation}; the device is now ${context.orientation}`,
		);
	if (
		capture.generation !== null &&
		context.generation !== null &&
		context.generation !== undefined &&
		capture.generation !== context.generation
	)
		fail(
			`capture ${capture.id} is from screen generation ${capture.generation}; the device is now at generation ${context.generation}`,
		);
	const { width, height } = capture.screen;
	if (width <= 0 || height <= 0)
		fail(`capture ${capture.id} has invalid pixel dimensions`);
	if (isPercent) {
		return {
			x: x / 100,
			y: y / 100,
			pixels: {
				x: Math.round((x / 100) * width),
				y: Math.round((y / 100) * height),
			},
			capture: capture.id,
			orientation: capture.orientation,
		};
	}
	if (x < 0 || x > width || y < 0 || y > height)
		fail(`point "${target}" px is outside the ${width}×${height} px screen`);
	return {
		x: x / width,
		y: y / height,
		pixels: { x, y },
		capture: capture.id,
		orientation: capture.orientation,
	};
}

function matchesTestId(node: AxViewNode, query: string): boolean {
	if (!node.testId) return false;
	return node.testId === query || node.testId.split("/").pop() === query;
}

/** Match an exact test ID or label. Case-insensitive labels are still exact. */
export function matchAxNodes(
	nodes: readonly AxViewNode[],
	query: string,
): AxViewNode[] {
	const all = flattenAxView(nodes);
	const byTestId = all.filter((node) => matchesTestId(node, query));
	if (byTestId.length > 0) return byTestId;
	const exact = all.filter(
		(node) => node.label === query || node.value === query,
	);
	if (exact.length > 0) return exact;
	const folded = query.toLowerCase();
	return all.filter(
		(node) =>
			node.label.toLowerCase() === folded ||
			node.value.toLowerCase() === folded,
	);
}

function resolveLabel(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
): TargetCheck {
	const snapshot = requireSnapshot(store, device);
	const matches = matchAxNodes(snapshot.nodes, selector.target).filter(
		(node) => !selector.role || node.role === selector.role,
	);
	if (matches.length === 0) {
		const role = selector.role ? ` with role ${selector.role}` : "";
		fail(`no node matches "${selector.target}"${role} in snapshot ${snapshot.id}. Run observe`);
	}
	if (selector.index !== undefined) {
		const node = matches[selector.index - 1];
		if (!node)
			fail(
				`only ${matches.length} nodes match "${selector.target}". Index ${selector.index} is too high`,
			);
		return requireActionable(store, device, snapshot, node);
	}
	if (matches.length > 1) {
		// A row and the text inside it carry the same name. Only one can act.
		const actionable = matches.filter((node) =>
			isActionable(store, device, node),
		);
		if (actionable.length === 1)
			return requireActionable(store, device, snapshot, actionable[0]!);
		const list = matches
			.map((node, index) => `  - ${describeAxNode(node)} --index ${index + 1}`)
			.join("\n");
		fail(
			`${matches.length} nodes match "${selector.target}". Use a ref, or add --index:\n${list}`,
		);
	}
	return requireActionable(store, device, snapshot, matches[0]!);
}

/** A ref or a label names a node. A point names a place on the screen. */
export function isPointTarget(target: string): boolean {
	return POINT_PATTERN.test(target.trim().replace(/\s+/g, ""));
}

function checkTargetNode(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
): TargetCheck {
	const target = selector.target.trim();
	if (selector.capture)
		fail("capture IDs are only valid with pixel or percent coordinates");
	if (isRefTarget(target)) return resolveRef(store, device, target);
	return resolveLabel(store, device, { ...selector, target });
}

export function resolveTargetNode(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
): AxViewNode {
	return checkTargetNode(store, device, selector).node;
}

export function nodePoint(node: AxViewNode): ResolvedPoint {
	return pointOfNode(node);
}

function identityOf(node: AxViewNode): NodeIdentity {
	return {
		id: node.id,
		path: node.path,
		role: node.role,
		...(node.windowId === undefined ? {} : { windowId: node.windowId }),
		...(node.sourceId === undefined ? {} : { sourceId: node.sourceId }),
		label: node.label,
		value: node.value,
		...(node.testId === undefined ? {} : { testId: node.testId }),
		box: node.box,
	};
}

function matchesIdentity(node: AxViewNode, identity: NodeIdentity): boolean {
	if (identity.windowId !== undefined && identity.sourceId !== undefined)
		return (
			node.windowId === identity.windowId &&
			node.sourceId === identity.sourceId &&
			node.role === identity.role
		);
	return (
		node.id === identity.id &&
		node.path === identity.path &&
		node.role === identity.role &&
		(identity.windowId === undefined || node.windowId === identity.windowId)
	);
}

/** A list can re-render between observe and dispatch. Hold the same row. */
const MOVE_TOLERANCE = 0.1;

function movedWithinTolerance(
	node: AxViewNode,
	identity: NodeIdentity,
	screenHeight: number,
): boolean {
	if (screenHeight <= 0) return false;
	const before = centreOf(identity.box);
	const after = centreOf(node.box);
	const distance = Math.hypot(after.x - before.x, after.y - before.y);
	return distance < screenHeight * MOVE_TOLERANCE;
}

/** The same row after a re-render: same role, same words, nearly the same place. */
function matchesMovedNode(
	node: AxViewNode,
	identity: NodeIdentity,
	screenHeight: number,
): boolean {
	if (!identity.label && !identity.testId) return false;
	if (node.role !== identity.role) return false;
	if (node.label !== identity.label || node.value !== identity.value)
		return false;
	if (identity.testId !== undefined && node.testId !== identity.testId)
		return false;
	if (identity.windowId !== undefined && node.windowId !== identity.windowId)
		return false;
	return movedWithinTolerance(node, identity, screenHeight);
}

const MOVED_WARNING = "target moved; re-resolved by label";

/** Identity first. A re-rendered row still answers to its role and label. */
function rematch(
	store: SnapshotStore,
	device: string,
	nodes: readonly AxViewNode[],
	identity: NodeIdentity,
	screenHeight: number,
): { node: AxViewNode; moved: boolean } | null {
	const exact = nodes.filter((node) => matchesIdentity(node, identity));
	if (exact.length === 1) return { node: exact[0]!, moved: false };
	const moved = nodes.filter((node) =>
		matchesMovedNode(node, identity, screenHeight),
	);
	if (moved.length === 1) return { node: moved[0]!, moved: true };
	const actionable = moved.filter((node) => isActionable(store, device, node));
	if (actionable.length === 1) return { node: actionable[0]!, moved: true };
	return null;
}

export function revalidateTargetNode(
	store: SnapshotStore,
	device: string,
	target: AxViewNode,
): AxViewNode {
	const snapshot = requireSnapshot(store, device);
	const match = rematch(
		store,
		device,
		flattenAxView(snapshot.nodes),
		identityOf(target),
		snapshot.screen.height,
	);
	if (!match)
		fail(`${describeAxNode(target)} changed before dispatch. Run observe again`);
	return requireActionable(store, device, snapshot, match.node).node;
}

function resolvedSelector(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
	context: TargetResolutionContext,
): {
	point: ResolvedPoint;
	node: AxViewNode | null;
	warning?: string;
} {
	const target = selector.target.trim();
	if (!isPointTarget(target)) {
		const check = checkTargetNode(store, device, { ...selector, target });
		return {
			point: pointOfNode(check.node),
			node: check.node,
			...(check.warning ? { warning: check.warning } : {}),
		};
	}
	return {
		point: resolveTarget(store, device, { ...selector, target }, context),
		node: null,
	};
}

export function revalidateActionTargets(
	store: SnapshotStore,
	device: string,
	request: ResolvedActions,
): ResolvedActions {
	if (request.semanticTargets.length === 0) return request;
	const snapshot = requireSnapshot(store, device);
	const nodes = flattenAxView(snapshot.nodes);
	const actions = request.actions.map((action) =>
		action && typeof action === "object" ? { ...action } : action,
	);
	const resolved = request.resolved.map((action) => ({
		...action,
		...(action.from ? { from: { ...action.from } } : {}),
		...(action.to ? { to: { ...action.to } } : {}),
	}));
	const warnings: string[] = [];
	// The fresh snapshot carries fresh refs, so the old notes no longer read true.
	for (const target of request.semanticTargets)
		delete resolved[target.action]?.warnings;
	const note = (index: number, warning: string): void => {
		if (!warnings.includes(warning)) warnings.push(warning);
		const result = resolved[index]!;
		const list = result.warnings ?? [];
		if (!list.includes(warning)) result.warnings = [...list, warning];
	};
	for (const target of request.semanticTargets) {
		const match = rematch(
			store,
			device,
			nodes,
			target.identity,
			snapshot.screen.height,
		);
		if (!match) fail("The target changed before dispatch. Run observe again");
		const check = requireActionable(store, device, snapshot, match.node);
		const previous =
			target.endpoint === "to"
				? resolved[target.action]?.to
				: resolved[target.action]?.from;
		const point = {
			...pointOfNode(check.node),
			...(previous?.ref ? { ref: previous.ref } : {}),
		};
		const action = actions[target.action] as Record<string, unknown>;
		const result = resolved[target.action]!;
		if (match.moved) note(target.action, MOVED_WARNING);
		if (check.warning) note(target.action, check.warning);
		if (target.endpoint === "to") {
			action.x2 = point.x;
			action.y2 = point.y;
			result.to = point;
		} else if (result.type === "swipe") {
			action.x1 = point.x;
			action.y1 = point.y;
			result.from = point;
		} else {
			action.x = point.x;
			action.y = point.y;
			result.from = point;
		}
	}
	return {
		...request,
		actions,
		resolved,
		...(warnings.length > 0 ? { warnings } : {}),
	};
}

export function resolveTarget(
	store: SnapshotStore,
	device: string,
	selector: TargetSelector,
	context: TargetResolutionContext = {},
): ResolvedPoint {
	const target = selector.target.trim();
	if (isRefTarget(target)) {
		if (selector.capture)
			fail("capture IDs are only valid with pixel or percent coordinates");
		return pointOfNode(resolveRef(store, device, target).node);
	}
	const point = resolvePoint(
		store,
		device,
		{ ...selector, target },
		context,
	);
	if (point) return point;
	if (selector.capture)
		fail("capture IDs are only valid with pixel or percent coordinates");
	return pointOfNode(resolveLabel(store, device, { ...selector, target }).node);
}

/** Report a validated action that does not use a semantic or visual target. */
function describeDeviceAction(action: DeviceAction): ResolvedAction {
	switch (action.type) {
		case "tap":
			return { type: "tap", from: { x: action.x, y: action.y } };
		case "long-press":
			return { type: "long-press", from: { x: action.x, y: action.y } };
		case "gesture":
			return {
				type: "gesture",
				phase: action.phase,
				from: { x: action.x, y: action.y },
			};
		case "swipe":
			return {
				type: "swipe",
				from: { x: action.x1, y: action.y1 },
				to: { x: action.x2, y: action.y2 },
			};
		case "type":
			return { type: "type", text: action.text };
		case "key":
			return { type: "key", key: action.key };
		case "button":
			return { type: "button", button: action.button };
		case "rotate":
			return { type: "rotate", orientation: action.orientation };
	}
}

/** Turn validated target forms into the 0-1 fractions input frames take. */
export function resolveActionTargets(
	store: SnapshotStore,
	device: string,
	values: ReadonlyArray<unknown>,
	context: TargetResolutionContext = {},
): ResolvedActions {
	const actions: unknown[] = [];
	const resolved: ResolvedAction[] = [];
	const semanticTargets: ResolvedActions["semanticTargets"] = [];
	const warnings: string[] = [];
	const notes = (...found: ReadonlyArray<string | undefined>): string[] => {
		const list = found.filter((warning): warning is string =>
			Boolean(warning),
		);
		for (const warning of list)
			if (!warnings.includes(warning)) warnings.push(warning);
		return list;
	};
	let captureBound = false;
	for (const value of values) {
		if (!isTargetAction(value)) {
			const direct = DeviceActionSchema.safeParse(value);
			if (!direct.success)
				fail(direct.error.issues[0]?.message ?? "the action is not valid");
			if (
				direct.data.type === "tap" ||
				direct.data.type === "long-press" ||
				direct.data.type === "swipe" ||
				direct.data.type === "gesture"
			)
				fail("bare coordinates are not accepted. Use a capture ID with the point");
			actions.push(direct.data);
			resolved.push(describeDeviceAction(direct.data));
			continue;
		}
		const parsed = TargetActionSchema.safeParse(value);
		if (!parsed.success)
			fail(parsed.error.issues[0]?.message ?? "the action is not valid");
		const action = parsed.data;
		if (action.type === "swipe") {
			const selector = (target: string): TargetSelector => ({
				target,
				...(action.capture ? { capture: action.capture } : {}),
				...(action.role ? { role: action.role } : {}),
				...(action.index === undefined ? {} : { index: action.index }),
			});
			const fromTarget = resolvedSelector(
				store,
				device,
				selector(action.from),
				context,
			);
			const toTarget = resolvedSelector(
				store,
				device,
				selector(action.to),
				context,
			);
			const from = fromTarget.point;
			const to = toTarget.point;
			captureBound ||= Boolean(from.capture || to.capture);
			const actionIndex = actions.length;
			actions.push({
				type: "swipe",
				x1: from.x,
				y1: from.y,
				x2: to.x,
				y2: to.y,
				...(action.durationMs === undefined
					? {}
					: { durationMs: action.durationMs }),
			});
			const swipeNotes = notes(fromTarget.warning, toTarget.warning);
			resolved.push({
				type: "swipe",
				from,
				to,
				...(swipeNotes.length > 0 ? { warnings: swipeNotes } : {}),
			});
			if (fromTarget.node)
				semanticTargets.push({
					action: actionIndex,
					endpoint: "from",
					identity: identityOf(fromTarget.node),
				});
			if (toTarget.node)
				semanticTargets.push({
					action: actionIndex,
					endpoint: "to",
					identity: identityOf(toTarget.node),
				});
			continue;
		}
		const target = resolvedSelector(store, device, action, context);
		const from = target.point;
		captureBound ||= Boolean(from.capture);
		const actionIndex = actions.length;
		const found = notes(target.warning);
		const reported = found.length > 0 ? { warnings: found } : {};
		if (action.type === "gesture") {
			actions.push({
				type: "gesture",
				phase: action.phase,
				x: from.x,
				y: from.y,
			});
			resolved.push({
				type: "gesture",
				phase: action.phase,
				from,
				...reported,
			});
		} else if (action.type === "long-press") {
			actions.push({
				type: "long-press",
				x: from.x,
				y: from.y,
				...(action.durationMs === undefined
					? {}
					: { durationMs: action.durationMs }),
			});
			resolved.push({ type: "long-press", from, ...reported });
		} else {
			actions.push({ type: "tap", x: from.x, y: from.y });
			resolved.push({ type: "tap", from, ...reported });
		}
		if (target.node)
			semanticTargets.push({
				action: actionIndex,
				endpoint: "from",
				identity: identityOf(target.node),
			});
	}
	if (captureBound && actions.length > 1)
		fail("capture-bound coordinates must be the only action in a request");
	return {
		actions,
		resolved,
		semanticTargets,
		...(warnings.length > 0 ? { warnings } : {}),
	};
}
