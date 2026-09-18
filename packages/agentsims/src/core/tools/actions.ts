import { Effect } from "effect";
import {
	InvalidCommandInput,
	withActionEffect,
	type ApplicationCommandError,
} from "./errors";
import {
	makeDeviceActions,
	type DeviceInputSession,
	type Pause,
} from "./input";
import type { AxSnapshot } from "./observe/accessibility-model";
import { flattenAxView, type AxViewNode } from "./observe/ax-view";
import {
	captureDeviceScreenshot,
	isStructuralOnly,
	observeDevice,
	type CaptureChannel,
	type CapturedAccessibility,
	type DeviceObservation,
	type ImageCaptureChannel,
	type ObservationSession,
	type ObserveDependencies,
} from "./observe/observe";
import type { DeviceSnapshot } from "./observe/snapshot-store";
import {
	describeAxNode,
	isPointTarget,
	revalidateActionTargets,
	resolveActionTargets,
	type ResolvedAction,
	type ResolvedActions,
	type ResolvedPoint,
} from "./observe/targets";
import {
	isTextInput,
	runTextInput,
	TextInputSchema,
	type FieldSession,
	type TextEntry,
	type TextVerification,
} from "./text-input";

export type ActionOptions = {
	/** Always capture the screen after the action. */
	screenshot?: boolean;
	/**
	 * Coordinates a server-side tool resolved itself, such as the swipe scroll
	 * computes from a container box. The runner dispatches them as they are.
	 */
	resolvedActions?: ResolvedActions;
};

export type ActionDispatch = {
	status: "accepted" | "none" | "unknown";
	reason: string;
};

export type ActionVerification = {
	status: "matched" | "mismatch" | "unavailable" | "not_applicable";
	reason: string;
	observed: Record<string, unknown> | null;
};

export type ActionCaptureReason =
	| "explicit"
	| "coordinate"
	| "ax_failed"
	| "ax_unusable"
	| "foreground_changed"
	| "window_changed"
	| "ax_unchanged";

export type ActionResult = {
	device: string;
	dispatch: ActionDispatch;
	verification: ActionVerification;
	resolved: ResolvedAction[];
	accessibility: CaptureChannel<CapturedAccessibility>;
	view: DeviceSnapshot | null;
	image: ImageCaptureChannel | null;
	captureReason: ActionCaptureReason | null;
	warnings: string[];
	/** Present for a type action. TEXT owns its final verification contract. */
	text?: TextEntry;
};

export type ActionDependencies = Omit<ObserveDependencies, "resolveSession"> & {
	resolveSession: (
		device: string,
	) => Effect.Effect<
		ObservationSession & DeviceInputSession & FieldSession,
		ApplicationCommandError
	>;
};

export type UiOperationVerification = {
	kind: "foreground_app";
	operation: "launch" | "stop";
	expected: string;
};

export interface DeviceActionRunner {
	(
		device: string,
		values: ReadonlyArray<unknown>,
		options?: ActionOptions,
	): Effect.Effect<ActionResult>;
	operation(
		device: string,
		operation: Effect.Effect<unknown, ApplicationCommandError>,
		verification: UiOperationVerification,
		options?: ActionOptions,
	): Effect.Effect<ActionResult>;
}

type PostActionState = {
	observation: DeviceObservation | null;
	accessibility: CaptureChannel<CapturedAccessibility>;
	view: DeviceSnapshot | null;
	warnings: string[];
};

type ActionState = {
	dispatch: ActionDispatch;
	verification: ActionVerification;
	resolved: ResolvedAction[];
	text?: TextEntry;
	post?: PostActionState;
	/** Generic input verifies itself after the read. It keeps its own before. */
	input?: { before: DeviceSnapshot | null };
};

const NOTHING_SENT_WARNING =
	"Nothing was sent to the device. Refs and captures from the last observation are still valid.";
const FRESH_TREE_WARNING =
	"Nothing was sent to the device. The check before dispatch re-read the screen, so the tree below is current and its refs replace the earlier ones.";

function actionUsesPoint(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	const action = value as Record<string, unknown>;
	return [action.target, action.from, action.to, action.into].some(
		(target) => typeof target === "string" && isPointTarget(target),
	);
}

function configOrientation(config: unknown): string | null {
	if (!config || typeof config !== "object") return null;
	const orientation = (config as { orientation?: unknown }).orientation;
	return typeof orientation === "string" && orientation ? orientation : null;
}

function configGeneration(config: unknown): number | null {
	if (!config || typeof config !== "object") return null;
	const value = config as {
		presentationGeneration?: unknown;
		generation?: unknown;
	};
	const generation = value.presentationGeneration ?? value.generation;
	return typeof generation === "number" && Number.isFinite(generation)
		? generation
		: null;
}

/** The live screen size. A percent point needs it, not a screenshot. */
function configScreen(
	config: unknown,
): { width: number; height: number } | null {
	if (!config || typeof config !== "object") return null;
	const value = config as { width?: unknown; height?: unknown };
	return typeof value.width === "number" &&
		typeof value.height === "number" &&
		value.width > 0 &&
		value.height > 0
		? { width: value.width, height: value.height }
		: null;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function operationFailureStatus(
	error: ApplicationCommandError,
): Extract<ActionDispatch["status"], "none" | "unknown"> {
	if (error.effect === "none") return "none";
	if (error.effect === "unknown") return "unknown";
	return error._tag === "InvalidCommandInput" ||
		error._tag === "CommandUnavailable"
		? "none"
		: "unknown";
}

function postFailure(error: unknown): PostActionState {
	const message = messageOf(error);
	return {
		observation: null,
		accessibility: {
			status: "error",
			capturedAt: Date.now(),
			error: message,
		},
		view: null,
		warnings: [`The accessibility read after the action failed: ${message}`],
	};
}

function comparableSnapshot(
	view: DeviceSnapshot | null,
	snapshot: AxSnapshot | null,
): string | null {
	if (!view || !snapshot) return null;
	return JSON.stringify({
		app: view.app,
		screen: view.screen,
		elements: snapshot.elements.map((element) => ({
			path: element.path,
			id: element.id,
			label: element.label,
			value: element.value,
			role: element.role,
			type: element.type,
			enabled: element.enabled,
			visibleToUser: element.visibleToUser,
			frame: element.frame,
			traits: element.traits,
			testId: element.testId,
			windowId: element.windowId,
			windowLayer: element.windowLayer,
			windowType: element.windowType,
			windowActive: element.windowActive,
			windowFocused: element.windowFocused,
		})),
	});
}

function comparableWindows(snapshot: AxSnapshot | null): string | null {
	if (!snapshot) return null;
	return JSON.stringify(
		snapshot.elements
			.filter((element) => !element.path.includes("."))
			.map((element) => ({
				path: element.path,
				id: element.id,
				type: element.type,
				frame: element.frame,
				visibleToUser: element.visibleToUser,
				windowId: element.windowId,
				windowLayer: element.windowLayer,
				windowType: element.windowType,
				windowActive: element.windowActive,
				windowFocused: element.windowFocused,
			})),
	);
}

function isPerceptionAction(actions: readonly ResolvedAction[]): boolean {
	return actions.some((action) =>
		["tap", "long-press", "swipe", "gesture", "button", "key"].includes(
			action.type,
		),
	);
}

function verificationForText(
	entry: TextEntry,
	verification: TextVerification,
): ActionVerification {
	const observed = {
		expected: entry.expected,
		value: entry.value,
		field: entry.field,
	};
	return {
		...verification,
		observed,
	};
}

function verificationForForeground(
	verification: UiOperationVerification,
	post: PostActionState,
): ActionVerification {
	const observed = post.observation?.context.app ?? post.view?.app ?? null;
	if (observed === null)
		return {
			status: "unavailable",
			reason: "The foreground app is unavailable.",
			observed: null,
		};
	const matched =
		verification.operation === "launch"
			? observed === verification.expected
			: observed !== verification.expected;
	return {
		status: matched ? "matched" : "mismatch",
		reason: matched
			? "The foreground app matches the requested app operation."
			: "The foreground app does not match the requested app operation.",
		observed: { foregroundApp: observed, expected: verification.expected },
	};
}

/** Report the snapshot the device still holds. A refusal changed nothing. */
function currentAccessibility(
	view: DeviceSnapshot | null,
	snapshot: AxSnapshot | null,
): CaptureChannel<CapturedAccessibility> {
	if (!view || !snapshot)
		return {
			status: "error",
			capturedAt: Date.now(),
			error: "No accessibility snapshot is available. Run observe.",
		};
	return {
		status: "ok",
		capturedAt: Date.now(),
		value: { snapshot, view, observationId: view.id },
	};
}

function viewNodes(view: DeviceSnapshot | null): AxViewNode[] {
	return view ? flattenAxView(view.nodes) : [];
}

function inputPoint(
	resolved: readonly ResolvedAction[],
): ResolvedPoint | null {
	for (const action of resolved) if (action.from?.ref) return action.from;
	return resolved[0]?.from ?? null;
}

function nodeByRef(
	view: DeviceSnapshot | null,
	ref: string | undefined,
): AxViewNode | null {
	if (!ref) return null;
	return viewNodes(view).find((node) => node.ref === ref) ?? null;
}

/** The same node after the action. Refs are new, so match on identity. */
function nodeAgain(
	view: DeviceSnapshot | null,
	node: AxViewNode,
): AxViewNode | null {
	const nodes = viewNodes(view);
	const same = nodes.filter(
		(candidate) =>
			(candidate.testId ?? "") === (node.testId ?? "") &&
			candidate.role === node.role &&
			candidate.label === node.label,
	);
	if (same.length === 1) return same[0]!;
	return (
		nodes.find((candidate) => candidate.path === node.path) ?? same[0] ?? null
	);
}

function nodeSignature(node: AxViewNode): unknown {
	return {
		path: node.path,
		role: node.role,
		label: node.label,
		value: node.value,
		states: node.states,
		box: node.box,
		...(node.testId ? { testId: node.testId } : {}),
	};
}

/** The comparable form of a published view. The before read keeps no tree. */
function comparableView(view: DeviceSnapshot | null): string | null {
	if (!view) return null;
	return JSON.stringify({
		app: view.app,
		screen: view.screen,
		nodes: viewNodes(view).map(nodeSignature),
	});
}

function subtreeText(nodes: readonly AxViewNode[]): string {
	return flattenAxView(nodes)
		.map((node) => `${node.role}|${node.label}|${node.value}`)
		.join("\n");
}

function firstLabel(nodes: readonly AxViewNode[]): string | null {
	return flattenAxView(nodes).find((node) => node.label)?.label ?? null;
}

/** Pruning can drop a window root, so the root path stands in for its ID. */
function windowKey(node: AxViewNode): string {
	return node.windowId === undefined
		? `p${node.path.split(".")[0]}`
		: `w${node.windowId}`;
}

const REF_SUFFIX = / \[ref=[^\]]*\]/;

/** Name a window the way describeAxNode does, with its first labels. */
function describeWindow(root: AxViewNode): string {
	const labels = flattenAxView([root])
		.filter((node) => node !== root && node.label)
		.slice(0, 3)
		.map((node) => node.label);
	const head = describeAxNode(root).replace(REF_SUFFIX, "");
	return labels.length > 0 ? `${head} (${labels.join(", ")})` : head;
}

/** The windows the action opened. Report at most three. */
function newWindows(
	before: DeviceSnapshot | null,
	after: DeviceSnapshot,
): string[] {
	const known = new Set((before?.nodes ?? []).map(windowKey));
	return after.nodes
		.filter((node) => !known.has(windowKey(node)))
		.slice(0, 3)
		.map(describeWindow);
}

function scrollerAt(
	view: DeviceSnapshot,
	point: ResolvedPoint,
): AxViewNode | null {
	const x = point.pixels?.x ?? point.x * view.screen.width;
	const y = point.pixels?.y ?? point.y * view.screen.height;
	const candidates = viewNodes(view).filter(
		(node) =>
			node.box.width > 0 &&
			node.box.height > 0 &&
			x >= node.box.x &&
			x <= node.box.x + node.box.width &&
			y >= node.box.y &&
			y <= node.box.y + node.box.height &&
			(node.states.includes("scrollable") ||
				node.role === "scrollview" ||
				node.role === "list"),
	);
	return (
		candidates.sort(
			(left, right) =>
				left.box.width * left.box.height - right.box.width * right.box.height,
		)[0] ?? null
	);
}

function checkedVerification(
	target: AxViewNode,
	after: AxViewNode | null,
): ActionVerification {
	const before = target.states.includes("checked");
	if (!after)
		return {
			status: "unavailable",
			reason: "The target is no longer in the accessibility tree.",
			observed: { checked: { before, after: null } },
		};
	const now = after.states.includes("checked");
	const flipped = now !== before;
	return {
		status: flipped ? "matched" : "mismatch",
		reason: flipped
			? "The target changed its checked state."
			: "The target kept its checked state.",
		observed: { checked: { before, after: now } },
	};
}

function sliderVerification(
	target: AxViewNode,
	after: AxViewNode | null,
): ActionVerification {
	if (!after)
		return {
			status: "unavailable",
			reason: "The slider is no longer in the accessibility tree.",
			observed: { value: { before: target.value, after: null } },
		};
	const changed = after.value !== target.value;
	return {
		status: changed ? "matched" : "mismatch",
		reason: changed
			? "The slider value changed."
			: "The slider value did not change.",
		observed: { value: { before: target.value, after: after.value } },
	};
}

const OBSERVED_AFTER = "Observed after the action.";

function screenChanged(
	before: DeviceSnapshot | null,
	after: DeviceSnapshot,
): boolean {
	const beforeText = comparableView(before);
	return beforeText !== null && beforeText !== comparableView(after);
}

function foregroundApp(after: PostActionState): string | null {
	return after.observation?.context.app ?? after.view?.app ?? null;
}

/** A swipe, scroll, or drag has no checkable property. Report the content. */
function swipeObservation(
	before: DeviceSnapshot | null,
	view: DeviceSnapshot,
	start: ResolvedPoint | undefined,
): ActionVerification {
	const scroller = before && start ? scrollerAt(before, start) : null;
	const beforeNodes = scroller ? [scroller] : (before?.nodes ?? []);
	const again = scroller ? nodeAgain(view, scroller) : null;
	const afterNodes = scroller ? (again ? [again] : []) : view.nodes;
	return {
		status: "not_applicable",
		reason: OBSERVED_AFTER,
		observed: {
			contentMoved:
				before !== null && subtreeText(beforeNodes) !== subtreeText(afterNodes),
			firstVisible: {
				before: firstLabel(scroller ? scroller.children : beforeNodes),
				after: firstLabel(again ? again.children : afterNodes),
			},
		},
	};
}

/** A device button leaves no target to read. Report screen and app. */
function buttonObservation(
	before: DeviceSnapshot | null,
	after: PostActionState,
	view: DeviceSnapshot,
): ActionVerification {
	return {
		status: "not_applicable",
		reason: OBSERVED_AFTER,
		observed: {
			screenChanged: screenChanged(before, view),
			foregroundApp: {
				before: before?.app ?? null,
				after: foregroundApp(after),
			},
		},
	};
}

/** A tap or long press on a target without a checkable property. */
function touchObservation(
	before: DeviceSnapshot | null,
	after: PostActionState,
	view: DeviceSnapshot,
	target: AxViewNode | null,
): ActionVerification {
	return {
		status: "not_applicable",
		reason: OBSERVED_AFTER,
		observed: {
			screenChanged: screenChanged(before, view),
			foregroundApp: foregroundApp(after),
			newWindows: newWindows(before, view),
			gone: target !== null && nodeAgain(view, target) === null,
		},
	};
}

/**
 * Report what the input changed. Only a checkable property, such as a checked
 * state or a slider value, carries a matched or mismatch status. Every other
 * action reports facts and leaves the judgement to the reader.
 */
function verificationForInput(
	before: DeviceSnapshot | null,
	after: PostActionState,
	resolved: ResolvedAction[],
): ActionVerification {
	const view = after.view;
	if (!view)
		return {
			status: "unavailable",
			reason: "The accessibility read after the action is unavailable.",
			observed: null,
		};
	const target = nodeByRef(before, inputPoint(resolved)?.ref);
	if (
		target &&
		(target.states.includes("checked") || target.states.includes("unchecked"))
	)
		return checkedVerification(target, nodeAgain(view, target));
	if (target?.role === "slider")
		return sliderVerification(target, nodeAgain(view, target));
	const swipe = resolved.find((action) => action.type === "swipe");
	if (swipe) return swipeObservation(before, view, swipe.from);
	if (resolved.some((action) => action.type === "button"))
		return buttonObservation(before, after, view);
	return touchObservation(before, after, view, target);
}

function captureReason(input: {
	explicit: boolean;
	coordinate: boolean;
	dispatch: ActionDispatch;
	resolved: readonly ResolvedAction[];
	beforeView: DeviceSnapshot | null;
	beforeComparable: string | null;
	beforeWindows: string | null;
	post: PostActionState;
	afterComparable: string | null;
	afterWindows: string | null;
}): ActionCaptureReason | null {
	if (input.explicit) return "explicit";
	if (input.dispatch.status === "none") return null;
	if (input.coordinate) return "coordinate";
	if (input.post.accessibility.status === "error") return "ax_failed";
	if (isStructuralOnly(input.post.view)) return "ax_unusable";
	if (
		input.beforeView &&
		input.post.view &&
		input.beforeView.app !== input.post.view.app
	)
		return "foreground_changed";
	if (
		input.beforeWindows !== null &&
		input.afterWindows !== null &&
		input.beforeWindows !== input.afterWindows
	)
		return "window_changed";
	if (
		input.dispatch.status === "accepted" &&
		isPerceptionAction(input.resolved) &&
		input.beforeComparable !== null &&
		input.beforeComparable === input.afterComparable
	)
		return "ax_unchanged";
	return null;
}

export function makeDeviceActionRunner(
	dependencies: ActionDependencies,
	pause?: Pause,
): DeviceActionRunner {
	const dispatch = makeDeviceActions(dependencies.resolveSession, pause);
	const locks = new Map<string, Effect.Semaphore>();
	const lockFor = (device: string): Effect.Semaphore => {
		let lock = locks.get(device);
		if (!lock) {
			lock = Effect.unsafeMakeSemaphore(1);
			locks.set(device, lock);
		}
		return lock;
	};
	const mutate = (device: string) =>
		Effect.sync(() => dependencies.store.mutate(device));
	const dispatchAndInvalidate = (
		device: string,
		actions: ReadonlyArray<unknown>,
		beforeDispatch?: () => void,
	) =>
		dispatch(device, actions, beforeDispatch).pipe(
			Effect.tap(() => mutate(device)),
			Effect.catchAll((error) =>
				error.effect === "unknown"
					? mutate(device).pipe(Effect.andThen(Effect.fail(error)))
					: Effect.fail(error),
			),
		);
	const readPost = (device: string) =>
		observeDevice(dependencies, device, { screenshot: false }).pipe(
			Effect.match({
				onFailure: postFailure,
				onSuccess: (observation): PostActionState => ({
					observation,
					accessibility: observation.accessibility,
					view: observation.view,
					warnings: observation.warnings,
				}),
			}),
		);
	const capture = (device: string) =>
		captureDeviceScreenshot(dependencies, device).pipe(
			Effect.match({
				onFailure: (error): ImageCaptureChannel => ({
					status: "error",
					capturedAt: Date.now(),
					error: messageOf(error),
				}),
				onSuccess: (result) => result.image,
			}),
		);
	const finish = (
		device: string,
		state: ActionState,
		options: ActionOptions,
		coordinate: boolean,
		beforeView: DeviceSnapshot | null,
		beforeComparable: string | null,
		beforeWindows: string | null,
		verification?: UiOperationVerification,
	) =>
		Effect.gen(function* () {
			if (state.dispatch.status === "none") {
				const view = dependencies.store.current(device);
				const kept: PostActionState = {
					observation: null,
					accessibility: currentAccessibility(
						view,
						dependencies.store.normalized(device),
					),
					view,
					warnings: [],
				};
				return {
					device,
					dispatch: state.dispatch,
					verification: verification
						? verificationForForeground(verification, kept)
						: state.verification,
					resolved: state.resolved,
					accessibility: kept.accessibility,
					view,
					image: null,
					captureReason: null,
					warnings: [
						...(state.post?.warnings ?? []),
						view !== null && beforeView !== view
							? FRESH_TREE_WARNING
							: NOTHING_SENT_WARNING,
					],
					...(state.text ? { text: state.text } : {}),
				};
			}
			let post = state.post ?? (yield* readPost(device));
			const afterSnapshot = dependencies.store.normalized(device);
			const reason = captureReason({
				explicit: options.screenshot === true,
				coordinate,
				dispatch: state.dispatch,
				resolved: state.resolved,
				beforeView,
				beforeComparable,
				beforeWindows,
				post,
				afterComparable: comparableSnapshot(post.view, afterSnapshot),
				afterWindows: comparableWindows(afterSnapshot),
			});
			const image = reason ? yield* capture(device) : null;
			if (
				post.view &&
				dependencies.store.current(device) !== post.view
			)
				post = yield* readPost(device);
			return {
				device,
				dispatch: state.dispatch,
				verification: verification
					? verificationForForeground(verification, post)
					: state.input
						? verificationForInput(state.input.before, post, state.resolved)
						: state.verification,
				resolved: state.resolved,
				accessibility: post.accessibility,
				view: post.view,
				image,
				captureReason: reason,
				warnings: post.warnings,
				...(state.text ? { text: state.text } : {}),
			};
		});
	const run = (
		device: string,
		values: ReadonlyArray<unknown>,
		options: ActionOptions = {},
	) =>
		lockFor(device).withPermits(1)(
			Effect.gen(function* () {
				const beforeView = dependencies.store.current(device);
				const beforeSnapshot = dependencies.store.normalized(device);
				let comparisonView = beforeView;
				let beforeComparable = comparableSnapshot(
					beforeView,
					beforeSnapshot,
				);
				let beforeWindows = comparableWindows(beforeSnapshot);
				const coordinate = values.some(actionUsesPoint);
				const typing = values.some(isTextInput);
				let latestTextObservation: DeviceObservation | null = null;
				const textObservation = () => latestTextObservation;
				let state: ActionState;
				if (typing) {
					const attempted = yield* Effect.gen(function* () {
						if (values.length > 1)
							return yield* Effect.fail(
								new InvalidCommandInput({
									message:
										"type must be the only action in a request. It reads the field after it writes",
									effect: "none",
								}),
							);
						const action = yield* Effect.try({
							try: () => TextInputSchema.parse(values[0]),
							catch: (cause) => withActionEffect(cause, "none"),
						});
						const session = yield* dependencies.resolveSession(device).pipe(
							Effect.mapError((error) => withActionEffect(error, "none")),
						);
						const config =
							action.into && isPointTarget(action.into)
								? yield* Effect.tryPromise({
										try: () => session.readConfig(),
										catch: (cause) => withActionEffect(cause, "none"),
									})
								: null;
						return yield* runTextInput(
							{
								device,
								store: dependencies.store,
								session,
								orientation: configOrientation(config),
								generation: configGeneration(config),
								dispatch: (actions, beforeDispatch) =>
									dispatchAndInvalidate(
										device,
										actions,
										beforeDispatch,
									),
								observe: () =>
									observeDevice(dependencies, device, {
										screenshot: false,
									}).pipe(
										Effect.tap((observation) =>
											Effect.sync(() => {
												latestTextObservation = observation;
											}),
										),
										Effect.map((observation) => ({
											view: observation.view,
											warnings: observation.warnings,
										})),
										Effect.catchAll((error) =>
											Effect.succeed({
												view: null,
												warnings: [
													`The accessibility read after the action failed: ${error.message}`,
												],
											}),
										),
									),
							},
							action,
						);
					}).pipe(
						Effect.match({
							onFailure: (error) => ({ ok: false as const, error }),
							onSuccess: (outcome) => ({ ok: true as const, outcome }),
						}),
					);
					if (attempted.ok) {
						const observed = textObservation();
						const post = attempted.outcome.entry.submit.requested &&
							attempted.outcome.entry.submit.status !== "suppressed"
							? yield* readPost(device)
							: observed
								? {
									observation: observed,
									accessibility: observed.accessibility,
									view: observed.view,
									warnings: attempted.outcome.warnings,
								}
								: undefined;
						state = {
							dispatch: {
								status: attempted.outcome.dispatch,
								reason: attempted.outcome.dispatchReason,
							},
							verification: verificationForText(
								attempted.outcome.entry,
								attempted.outcome.verification,
							),
							resolved: attempted.outcome.resolved,
							text: attempted.outcome.entry,
							...(post ? { post } : {}),
						};
					} else {
						const status = attempted.error.effect === "unknown" ? "unknown" : "none";
						state = {
							dispatch: { status, reason: attempted.error.message },
							verification: {
								status: "unavailable",
								reason: "The text operation did not return a verifiable result.",
								observed: null,
							},
							resolved: [],
						};
					}
				} else {
					const attempted = yield* Effect.gen(function* () {
						const config = coordinate
							? yield* dependencies.resolveSession(device).pipe(
									Effect.mapError((error) => withActionEffect(error, "none")),
									Effect.flatMap((session) =>
										Effect.tryPromise({
											try: () => session.readConfig(),
											catch: (cause) => withActionEffect(cause, "none"),
										}),
									),
								)
							: null;
						let request =
							options.resolvedActions ??
							(yield* Effect.try({
								try: () => {
									const screen = configScreen(config);
									return resolveActionTargets(
										dependencies.store,
										device,
										values,
										{
											orientation: configOrientation(config),
											generation: configGeneration(config),
											...(screen ? { screen } : {}),
										},
									);
								},
								catch: (cause) => withActionEffect(cause, "none"),
							}));
						if (request.semanticTargets.length > 0) {
							const fresh = yield* observeDevice(dependencies, device, {
								screenshot: false,
							});
							if (!fresh.view)
								return yield* Effect.fail(
									new InvalidCommandInput({
										message:
											fresh.accessibility.status === "error"
												? fresh.accessibility.error
												: "The target could not be checked before dispatch.",
										effect: "none",
									}),
								);
							comparisonView = fresh.view;
							const freshSnapshot = dependencies.store.normalized(device);
							beforeComparable = comparableSnapshot(
								fresh.view,
								freshSnapshot,
							);
							beforeWindows = comparableWindows(freshSnapshot);
							request = yield* Effect.try({
								try: () =>
									revalidateActionTargets(
										dependencies.store,
										device,
										request,
									),
								catch: (cause) => withActionEffect(cause, "none"),
							});
						}
						const version = dependencies.store.version(device);
						yield* dispatchAndInvalidate(device, request.actions, () => {
							if (!dependencies.store.isCurrent(device, version))
								throw new Error(
									"The device changed before dispatch. Run observe again.",
								);
						});
						return request.resolved;
					}).pipe(
						Effect.match({
							onFailure: (error) => ({ ok: false as const, error }),
							onSuccess: (resolved) => ({ ok: true as const, resolved }),
						}),
					);
					state = attempted.ok
						? {
								dispatch: {
									status: "accepted",
									reason: "The device accepted every input frame.",
								},
								verification: {
									status: "not_applicable",
									reason:
										"Generic input has no operation-specific success verifier.",
									observed: null,
								},
								resolved: attempted.resolved,
								input: { before: beforeView },
							}
						: {
								dispatch: {
									status:
										attempted.error.effect === "unknown" ? "unknown" : "none",
									reason: attempted.error.message,
								},
								verification: {
									status: "not_applicable",
									reason:
										"Generic input has no operation-specific success verifier.",
									observed: null,
								},
								resolved: [],
								input: { before: beforeView },
							};
				}
				return yield* finish(
					device,
					state,
					options,
					coordinate,
					comparisonView,
					beforeComparable,
					beforeWindows,
				);
			}),
		);
	const operation: DeviceActionRunner["operation"] = (
		device,
		effect,
		verification,
		options = {},
	) =>
		lockFor(device).withPermits(1)(
			Effect.gen(function* () {
				const beforeView = dependencies.store.current(device);
				const beforeSnapshot = dependencies.store.normalized(device);
				const attempted = yield* effect.pipe(
					Effect.match({
						onFailure: (error) => ({ ok: false as const, error }),
						onSuccess: () => ({ ok: true as const }),
					}),
				);
				const failureStatus = attempted.ok
					? null
					: operationFailureStatus(attempted.error);
				if (attempted.ok || failureStatus === "unknown")
					yield* mutate(device);
				const state: ActionState = {
					dispatch: attempted.ok
						? {
								status: "accepted",
								reason: "The device accepted the app operation.",
							}
						: {
							status: failureStatus ?? "unknown",
								reason: attempted.error.message,
							},
					verification: {
						status: "unavailable",
						reason: "The foreground app has not been read yet.",
						observed: null,
					},
					resolved: [],
				};
				return yield* finish(
					device,
					state,
					options,
					false,
					beforeView,
					comparableSnapshot(beforeView, beforeSnapshot),
					comparableWindows(beforeSnapshot),
					verification,
				);
			}),
		);
	return Object.assign(run, { operation });
}
