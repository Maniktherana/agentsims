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
import {
	captureDeviceScreenshot,
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
	isPointTarget,
	revalidateActionTargets,
	resolveActionTargets,
	type ResolvedAction,
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
};

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

function isStructuralOnly(view: DeviceSnapshot | null): boolean {
	return (
		!view ||
		view.screen.width <= 0 ||
		view.screen.height <= 0 ||
		view.shown === 0 ||
		view.nodes.length === 0
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
						let request = yield* Effect.try({
							try: () =>
								resolveActionTargets(dependencies.store, device, values, {
									orientation: configOrientation(config),
									generation: configGeneration(config),
								}),
							catch: (cause) => withActionEffect(cause, "none"),
						});
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
