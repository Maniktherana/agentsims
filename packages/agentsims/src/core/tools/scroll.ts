import { Effect } from "effect";
import { z } from "zod";
import type { ActionOptions, ActionResult } from "./actions";
import {
	InvalidCommandInput,
	withActionEffect,
	type ApplicationCommandError,
} from "./errors";
import type { AxRect, AxSnapshot } from "./observe/accessibility-model";
import {
	AX_ROLES,
	flattenAxView,
	type AxRole,
	type AxViewNode,
} from "./observe/ax-view";
import { observeDevice, type ObserveDependencies } from "./observe/observe";
import {
	isRefIdentifier,
	type DeviceSnapshot,
} from "./observe/snapshot-store";
import {
	matchAxNodes,
	resolveTargetNode,
	type ResolvedActions,
	type ResolvedPoint,
} from "./observe/targets";

export const SCROLL_DIRECTIONS = ["down", "up", "left", "right"] as const;
export type ScrollDirection = (typeof SCROLL_DIRECTIONS)[number];

/**
 * A scroll travels over the middle of the container. The default amount of 40
 * runs from 70% to 30% of the container, the span ARTEMIS uses, and the default
 * duration of 600 ms keeps the gesture slow enough to move content instead of
 * flinging it.
 */
export const DEFAULT_SCROLL_AMOUNT = 40;
export const DEFAULT_SCROLL_DURATION_MS = 600;
export const DEFAULT_DRAG_DURATION_MS = 800;
export const MAX_SCROLL_PAGES = 30;

export const ScrollRequestSchema = z.object({
	direction: z.enum(SCROLL_DIRECTIONS),
	/** A ref or label that names the region to scroll inside. */
	in: z.string().min(1).optional(),
	amount: z.number().finite().positive().max(100).optional(),
	durationMs: z.number().finite().positive().max(5_000).optional(),
	toEnd: z.boolean().optional(),
	collect: z.string().min(1).optional(),
	maxPages: z.number().int().positive().max(MAX_SCROLL_PAGES).optional(),
});
export type ScrollRequest = z.infer<typeof ScrollRequestSchema>;

export type ScrollContainerSource = "target" | "scrollable" | "screen";

export interface ScrollContainer {
	ref: string | null;
	role: AxRole | "screen";
	label: string;
	/** The platform tree path. It stays stable while refs change per observe. */
	path: string | null;
	box: AxRect;
	source: ScrollContainerSource;
}

export interface ScrollPoint {
	x: number;
	y: number;
}

export interface ScrollTravel {
	from: ScrollPoint;
	to: ScrollPoint;
}

export interface ScrollItem {
	ref: string;
	role: AxRole;
	label: string;
	value: string;
	testId?: string;
	/** The node text, or the text of its children when the node has none. */
	text: string;
}

export interface ScrollResult {
	device: string;
	direction: ScrollDirection;
	container: ScrollContainer;
	/** Screenshot pixels, so the report matches what the agent sees. */
	from: ScrollPoint;
	to: ScrollPoint;
	amount: number;
	durationMs: number;
	swipes: number;
	/** Distinct pages read. A scroll that moved nothing reports none. */
	pages: number;
	endReached: boolean;
	selector: string | null;
	count: number | null;
	items: ScrollItem[] | null;
	action: ActionResult;
}

export type ScrollDependencies = ObserveDependencies & {
	act: (
		device: string,
		values: ReadonlyArray<unknown>,
		options?: ActionOptions,
	) => Effect.Effect<ActionResult, ApplicationCommandError>;
};

const SCROLLABLE_ROLES: ReadonlySet<AxRole> = new Set<AxRole>([
	"scrollview",
	"list",
]);

function area(box: AxRect): number {
	return Math.max(0, box.width) * Math.max(0, box.height);
}

export function isScrollableNode(node: AxViewNode): boolean {
	return node.states.includes("scrollable") || SCROLLABLE_ROLES.has(node.role);
}

/** Android reports window state on tree roots. Prefer the active window. */
export function activeWindowPath(snapshot: AxSnapshot | null): string | null {
	if (!snapshot) return null;
	const roots = snapshot.elements.filter(
		(element) => !element.path.includes("."),
	);
	const active = roots
		.filter((root) => root.windowActive === true || root.windowFocused === true)
		.sort((a, b) => (b.windowLayer ?? 0) - (a.windowLayer ?? 0))[0];
	return active?.path ?? null;
}

function containerOfNode(
	node: AxViewNode,
	source: ScrollContainerSource,
): ScrollContainer {
	return {
		ref: node.ref,
		role: node.role,
		label: node.label || node.value,
		path: node.path,
		box: node.box,
		source,
	};
}

function screenContainer(view: DeviceSnapshot): ScrollContainer {
	return {
		ref: null,
		role: "screen",
		label: "",
		path: null,
		box: { x: 0, y: 0, width: view.screen.width, height: view.screen.height },
		source: "screen",
	};
}

/** The largest scrollable region of the active window, else the whole screen. */
export function defaultScrollContainer(
	view: DeviceSnapshot,
	snapshot: AxSnapshot | null = null,
): ScrollContainer {
	const windowPath = activeWindowPath(snapshot);
	const inActiveWindow = (node: AxViewNode): boolean =>
		!windowPath ||
		node.path === windowPath ||
		node.path.startsWith(`${windowPath}.`);
	const largest = flattenAxView(view.nodes)
		.filter(
			(node) =>
				isScrollableNode(node) && inActiveWindow(node) && area(node.box) > 0,
		)
		.reduce<AxViewNode | null>(
			(best, node) => (!best || area(node.box) > area(best.box) ? node : best),
			null,
		);
	return largest
		? containerOfNode(largest, "scrollable")
		: screenContainer(view);
}

/**
 * The finger travels over the centre of the container. `amount` is the percent
 * of the container it covers, centred on the middle: 40 runs 70% to 30%.
 */
export function scrollTravel(
	box: AxRect,
	direction: ScrollDirection,
	amount: number = DEFAULT_SCROLL_AMOUNT,
): ScrollTravel {
	// Cap the travel at 98% so the finger stays inside the region. A touch on
	// the very edge of the screen starts a system gesture, not a scroll.
	const half = Math.min(98, Math.max(1, amount)) / 200;
	const near = 0.5 + half;
	const far = 0.5 - half;
	const along = (start: number, length: number, fraction: number): number =>
		Math.round(start + length * fraction);
	const centre = (start: number, length: number): number =>
		Math.round(start + length / 2);
	// Down and right move content the way the agent reads. The finger goes the
	// other way, from the near edge of the travel to the far one.
	const forward = direction === "down" || direction === "right";
	const start = forward ? near : far;
	const end = forward ? far : near;
	if (direction === "down" || direction === "up")
		return {
			from: {
				x: centre(box.x, box.width),
				y: along(box.y, box.height, start),
			},
			to: { x: centre(box.x, box.width), y: along(box.y, box.height, end) },
		};
	return {
		from: { x: along(box.x, box.width, start), y: centre(box.y, box.height) },
		to: { x: along(box.x, box.width, end), y: centre(box.y, box.height) },
	};
}

function fraction(value: number, extent: number): number {
	if (!Number.isFinite(extent) || extent <= 0) return 0;
	return Math.min(1, Math.max(0, value / extent));
}

export interface ScrollSwipe {
	type: "swipe";
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	durationMs: number;
}

/** Input frames take 0-1 fractions, so the container maths stays server side. */
export function normalizedSwipe(
	travel: ScrollTravel,
	screen: { width: number; height: number },
	durationMs: number,
): ScrollSwipe {
	return {
		type: "swipe",
		x1: fraction(travel.from.x, screen.width),
		y1: fraction(travel.from.y, screen.height),
		x2: fraction(travel.to.x, screen.width),
		y2: fraction(travel.to.y, screen.height),
		durationMs,
	};
}

function resolvedSwipe(
	swipe: ScrollSwipe,
	travel: ScrollTravel,
	container: ScrollContainer,
): ResolvedActions {
	const from: ResolvedPoint = {
		x: swipe.x1,
		y: swipe.y1,
		pixels: travel.from,
		...(container.ref && container.role !== "screen"
			? {
					ref: container.ref,
					role: container.role,
					...(container.label ? { label: container.label } : {}),
				}
			: {}),
	};
	const to: ResolvedPoint = { x: swipe.x2, y: swipe.y2, pixels: travel.to };
	return {
		actions: [swipe],
		resolved: [{ type: "swipe", from, to }],
		semanticTargets: [],
	};
}

function nodeText(node: AxViewNode): string {
	const own = node.label || node.value;
	if (own) return own;
	return flattenAxView(node.children)
		.map((child) => child.label || child.value)
		.filter(Boolean)
		.join(" ");
}

function scrollItem(node: AxViewNode): ScrollItem {
	return {
		ref: node.ref,
		role: node.role,
		label: node.label,
		value: node.value,
		...(node.testId ? { testId: node.testId } : {}),
		text: nodeText(node),
	};
}

/** A collect selector names a role, a test ID, or an exact label. */
export function collectAxNodes(
	nodes: readonly AxViewNode[],
	selector: string,
): AxViewNode[] {
	const folded = selector.trim().toLowerCase();
	const role = (AX_ROLES as readonly string[]).includes(folded)
		? (folded as AxRole)
		: null;
	return role
		? flattenAxView(nodes).filter((node) => node.role === role)
		: matchAxNodes(nodes, selector.trim());
}

export function scrollItemKey(item: ScrollItem): string {
	return [item.testId ?? "", item.role, item.label, item.value, item.text].join(
		"|",
	);
}

/** Two pages with the same container text mean the scroll reached the end. */
export function containerText(
	view: DeviceSnapshot,
	path: string | null,
): string {
	const nodes = flattenAxView(view.nodes);
	const subtree = path
		? nodes.filter(
				(node) => node.path === path || node.path.startsWith(`${path}.`),
			)
		: nodes;
	return (subtree.length > 0 ? subtree : nodes)
		.map((node) => `${node.role}|${node.label}|${node.value}|${node.testId ?? ""}`)
		.join("\n");
}

/**
 * A list is scrollable even when the platform reports no scrollable trait,
 * which is every iOS node. Accept one unambiguous scrollable match that the
 * shared target rules turn down for its role alone.
 */
function scrollableTarget(
	store: ScrollDependencies["store"],
	device: string,
	target: string,
): AxViewNode | null {
	const current = store.current(device);
	if (!current) return null;
	let found: AxViewNode[];
	if (target.startsWith("@") || isRefIdentifier(target)) {
		const resolution = store.resolveRef(device, target);
		found = resolution.ok ? [resolution.node] : [];
	} else found = matchAxNodes(current.nodes, target);
	const scrollable = found.filter(isScrollableNode);
	return scrollable.length === 1 ? scrollable[0]! : null;
}

function resolveContainer(
	dependencies: ScrollDependencies,
	device: string,
	view: DeviceSnapshot,
	request: ScrollRequest,
): Effect.Effect<ScrollContainer, ApplicationCommandError> {
	if (!request.in)
		return Effect.succeed(
			defaultScrollContainer(view, dependencies.store.normalized(device)),
		);
	const target = request.in.trim();
	return Effect.try({
		try: () =>
			containerOfNode(
				resolveTargetNode(dependencies.store, device, { target }),
				"target",
			),
		catch: (cause) => withActionEffect(cause, "none"),
	}).pipe(
		Effect.catchAll((error) => {
			const fallback = scrollableTarget(dependencies.store, device, target);
			return fallback
				? Effect.succeed(containerOfNode(fallback, "target"))
				: Effect.fail(error);
		}),
	);
}

/**
 * Refs live in one observation, so reuse the snapshot the agent already read.
 * Every action clears it, which is when a scroll reads the screen itself.
 */
function currentView(
	dependencies: ScrollDependencies,
	device: string,
): Effect.Effect<DeviceSnapshot, ApplicationCommandError> {
	const current = dependencies.store.current(device);
	if (current) return Effect.succeed(current);
	return Effect.gen(function* () {
		const observation = yield* observeDevice(dependencies, device, {
			screenshot: false,
		});
		if (!observation.view)
			return yield* Effect.fail(
				new InvalidCommandInput({
					message:
						observation.accessibility.status === "error"
							? observation.accessibility.error
							: "The scroll region could not be read. Run observe",
					effect: "none",
				}),
			);
		return observation.view;
	});
}

/**
 * One scroll is one call: read the screen for the container, then dispatch the
 * computed swipe through the action runner. No capture ID, no client geometry.
 */
export function scrollDevice(
	dependencies: ScrollDependencies,
	device: string,
	request: ScrollRequest,
): Effect.Effect<ScrollResult, ApplicationCommandError> {
	return Effect.gen(function* () {
		const amount = request.amount ?? DEFAULT_SCROLL_AMOUNT;
		const durationMs = request.durationMs ?? DEFAULT_SCROLL_DURATION_MS;
		const maxPages = request.maxPages ?? MAX_SCROLL_PAGES;
		const view = yield* currentView(dependencies, device);
		const container = yield* resolveContainer(
			dependencies,
			device,
			view,
			request,
		);
		if (area(container.box) <= 0)
			return yield* Effect.fail(
				new InvalidCommandInput({
					message: "The scroll region has no area. Run observe",
					effect: "none",
				}),
			);
		const travel = scrollTravel(container.box, request.direction, amount);
		const swipe = normalizedSwipe(travel, view.screen, durationMs);
		const options: ActionOptions = {
			resolvedActions: resolvedSwipe(swipe, travel, container),
		};

		const items = new Map<string, ScrollItem>();
		const collect = (page: DeviceSnapshot): void => {
			if (!request.collect) return;
			for (const node of collectAxNodes(page.nodes, request.collect)) {
				const item = scrollItem(node);
				items.set(scrollItemKey(item), item);
			}
		};
		let signature = containerText(view, container.path);
		let pages = 0;
		// A whole-list read starts from the page the agent can already see. A
		// single scroll reports only the page it moved to.
		if (request.toEnd) {
			collect(view);
			pages = 1;
		}
		let swipes = 0;
		let endReached = false;
		let action: ActionResult | null = null;
		const limit = request.toEnd ? maxPages : 1;
		for (let index = 0; index < limit; index += 1) {
			action = yield* dependencies.act(device, [swipe], options);
			swipes += 1;
			if (action.dispatch.status !== "accepted") break;
			const page = action.view;
			if (!page) break;
			collect(page);
			const next = containerText(page, container.path);
			// A page that repeats the one before it is the end of the region, not
			// a new page.
			if (next === signature) {
				endReached = true;
				break;
			}
			pages += 1;
			signature = next;
		}
		if (!action)
			return yield* Effect.fail(
				new InvalidCommandInput({
					message: "The scroll dispatched no swipe",
					effect: "none",
				}),
			);
		return {
			device,
			direction: request.direction,
			container,
			from: travel.from,
			to: travel.to,
			amount,
			durationMs,
			swipes,
			pages,
			endReached,
			selector: request.collect ?? null,
			count: request.collect ? items.size : null,
			items: request.collect ? [...items.values()] : null,
			action,
		};
	});
}
