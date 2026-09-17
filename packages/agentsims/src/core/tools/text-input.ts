import { Effect } from "effect";
import { z } from "zod";
import {
	UnsupportedCharacterError,
	validateKeyboardText,
} from "../ios/text-to-keys";
import {
	InvalidCommandInput,
	withActionEffect,
	type ActionEffect,
	type ApplicationCommandError,
} from "./errors";
import {
	AX_ROLES,
	flattenAxView,
	type AxRole,
	type AxViewNode,
} from "./observe/ax-view";
import type { DeviceSnapshot, SnapshotStore } from "./observe/snapshot-store";
import {
	describeAxNode,
	isPointTarget,
	nodePoint,
	revalidateTargetNode,
	resolveTarget,
	resolveTargetNode,
	type ResolvedAction,
	type TargetSelector,
} from "./observe/targets";

export const TextInputSchema = z.object({
	type: z.literal("type"),
	text: z.string(),
	into: z.string().min(1).optional(),
	capture: z.string().min(1).optional(),
	role: z.enum(AX_ROLES).optional(),
	index: z.number().int().positive().optional(),
	clear: z.boolean().optional(),
	submit: z.boolean().optional(),
});
export type TextInputAction = z.infer<typeof TextInputSchema>;

export function isTextInput(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	return (value as { type?: unknown }).type === "type";
}

export type FieldAction = "set-text" | "focus";

export interface FieldIdentity {
	id?: string;
	path?: string;
	role?: AxRole;
	windowId?: number;
	sourceId?: number;
}

export interface DeviceField {
	/** What the field holds now. A hint is not a value. */
	value: string;
	editable: boolean;
	password: boolean;
	focused: boolean;
	/** Present only when the platform can bind focus to a node in the snapshot. */
	identity?: FieldIdentity;
	/** UTF-16 offsets, matching native text selection APIs. */
	selection?: { start: number; end: number };
}

export interface FieldRequest {
	/** A node path from the last snapshot, or `focus`. */
	node: string;
	action: FieldAction;
	text?: string;
	testId?: string;
	className?: string;
	identity?: FieldIdentity;
}

export interface FieldResult {
	performed: boolean;
	field: DeviceField | null;
}

export interface FieldSession {
	performField?(request: FieldRequest): Promise<FieldResult>;
	readFocusedField?(): Promise<DeviceField | null>;
}

export interface TextFieldLine {
	ref: string;
	role: AxRole;
	label: string;
	value: string;
}

export type TextSubmitResult =
	| {
			requested: false;
			status: "not_requested";
			reason: string;
	  }
	| {
			requested: true;
			status: "suppressed" | "accepted" | "unknown";
			reason: string;
	  };

export interface TextEntry {
	operation: "type" | "fill";
	text: string;
	expected: string | null;
	value: string | null;
	target: string | null;
	field: TextFieldLine | null;
	submit: TextSubmitResult;
}

export interface TextVerification {
	status: "matched" | "mismatch" | "unavailable";
	reason: string;
}

export interface TextInputOutcome {
	entry: TextEntry;
	verification: TextVerification;
	resolved: ResolvedAction[];
	/** The verification read. It is the post-input, pre-submit state. */
	view: DeviceSnapshot | null;
	warnings: string[];
	dispatch: "accepted" | "unknown";
	dispatchReason: string;
}

export interface TextInputContext {
	device: string;
	store: SnapshotStore;
	session: FieldSession;
	orientation?: string | null;
	generation?: number | null;
	dispatch(
		actions: ReadonlyArray<unknown>,
		beforeDispatch?: () => void,
	): Effect.Effect<unknown, ApplicationCommandError>;
	observe(): Effect.Effect<{
		view: DeviceSnapshot | null;
		warnings: string[];
	}>;
}

const TEXT_ROLES: ReadonlySet<AxRole> = new Set<AxRole>([
	"textbox",
	"securetextbox",
	"combobox",
]);

function refuse(
	message: string,
	effect: ActionEffect,
): Effect.Effect<never, ApplicationCommandError> {
	return Effect.fail(new InvalidCommandInput({ message, effect }));
}

function lineOf(node: AxViewNode): TextFieldLine {
	return {
		ref: node.ref,
		role: node.role,
		label: node.label,
		value: node.value,
	};
}

function sameNode(view: DeviceSnapshot, target: AxViewNode): AxViewNode | null {
	const fields = flattenAxView(view.nodes).filter((node) =>
		TEXT_ROLES.has(node.role),
	);
	if (target.windowId !== undefined && target.sourceId !== undefined) {
		const byNativeIdentity = fields.filter(
			(node) =>
				node.windowId === target.windowId &&
				node.sourceId === target.sourceId &&
				node.role === target.role,
		);
		return byNativeIdentity.length === 1 ? byNativeIdentity[0]! : null;
	}
	const byPath = fields.filter(
		(node) =>
			node.path === target.path &&
			node.role === target.role &&
			(!target.id || node.id === target.id),
	);
	if (byPath.length === 1) return byPath[0]!;
	if (!target.id) return null;
	const byId = fields.filter(
		(node) => node.id === target.id && node.role === target.role,
	);
	return byId.length === 1 ? byId[0]! : null;
}

function nodeForIdentity(
	view: DeviceSnapshot | null,
	identity: FieldIdentity | undefined,
): AxViewNode | null {
	if (!view || !identity || (!identity.id && !identity.path)) return null;
	const fields = flattenAxView(view.nodes).filter(
		(node) =>
			TEXT_ROLES.has(node.role) &&
			(!identity.role || node.role === identity.role) &&
			(identity.windowId === undefined || node.windowId === identity.windowId) &&
			(identity.sourceId === undefined || node.sourceId === identity.sourceId),
	);
	if (identity.windowId !== undefined && identity.sourceId !== undefined) {
		const byNativeIdentity = fields.filter(
			(node) =>
				node.windowId === identity.windowId &&
				node.sourceId === identity.sourceId,
		);
		return byNativeIdentity.length === 1 ? byNativeIdentity[0]! : null;
	}
	if (identity.path) {
		const byPath = fields.filter(
			(node) =>
				node.path === identity.path &&
				(!identity.id || node.id === identity.id),
		);
		return byPath.length === 1 ? byPath[0]! : null;
	}
	if (!identity.id) return null;
	const byId = fields.filter((node) => node.id === identity.id);
	return byId.length === 1 ? byId[0]! : null;
}

function validSelection(
	field: DeviceField | null,
): { start: number; end: number } | null {
	const selection = field?.selection;
	if (
		!selection ||
		!Number.isInteger(selection.start) ||
		!Number.isInteger(selection.end) ||
		selection.start < 0 ||
		selection.end < selection.start ||
		selection.end > field.value.length
	)
		return null;
	return selection;
}

function expectedTypedValue(field: DeviceField | null, text: string): string | null {
	if (!field || field.password) return null;
	const selection = validSelection(field);
	if (!selection) return null;
	return (
		field.value.slice(0, selection.start) +
		text +
		field.value.slice(selection.end)
	);
}

function validateLiteralText(text: string): Effect.Effect<void, ApplicationCommandError> {
	return Effect.try({
		try: () => validateKeyboardText(text),
		catch: (cause) =>
			withActionEffect(
				cause instanceof UnsupportedCharacterError
					? new Error(
							`${cause.message}. Only US-keyboard ASCII characters are supported.`,
						)
					: cause,
				"none",
			),
	});
}

function pointValues(node: AxViewNode): { x: number; y: number } {
	const point = nodePoint(node);
	return { x: point.x, y: point.y };
}

function unavailable(reason: string): TextVerification {
	return { status: "unavailable", reason };
}

function verificationFor(input: {
	operation: "type" | "fill";
	expected: string | null;
	field: AxViewNode | null;
	targetConfirmed: boolean;
	protectedValue: boolean;
}): TextVerification {
	if (!input.field)
		return unavailable("The target field is not present after input.");
	if (!input.targetConfirmed)
		return unavailable("The target field does not have focus after input.");
	if (input.protectedValue)
		return unavailable("The protected field does not expose a value.");
	if (input.expected === null)
		return unavailable(
			input.operation === "type"
				? "The current text selection is unavailable, so the complete value cannot be predicted."
				: "The complete expected value is unavailable.",
		);
	if (input.field.value === input.expected)
		return {
			status: "matched",
			reason: "The target field value matches the complete expected value.",
		};
	return {
		status: "mismatch",
		reason: "The target field value does not match the complete expected value.",
	};
}

export function runTextInput(
	context: TextInputContext,
	action: TextInputAction,
): Effect.Effect<TextInputOutcome, ApplicationCommandError> {
	return Effect.gen(function* () {
		if (action.capture && !action.into)
			return yield* refuse(
				"A capture ID requires a pixel or percent target.",
				"none",
			);
		const operation = action.clear ? "fill" : "type";
		const perform = context.session.performField;
		const readFocus = context.session.readFocusedField;
		const nativeFill = operation === "fill" && perform !== undefined;
		if (operation === "type" || !nativeFill)
			yield* validateLiteralText(action.text);

		let before = context.store.current(context.device);
		const selector: TargetSelector | null = action.into
			? {
					target: action.into,
					...(action.capture ? { capture: action.capture } : {}),
					...(action.role ? { role: action.role } : {}),
					...(action.index === undefined ? {} : { index: action.index }),
				}
			: null;
		const point =
			selector && isPointTarget(selector.target)
				? yield* Effect.try({
						try: () =>
							resolveTarget(context.store, context.device, selector, {
								orientation: context.orientation,
								generation: context.generation,
							}),
						catch: (cause) => withActionEffect(cause, "none"),
					})
				: null;
		let target =
			selector && !point
				? yield* Effect.try({
						try: () =>
							resolveTargetNode(context.store, context.device, selector),
						catch: (cause) => withActionEffect(cause, "none"),
					})
				: null;
		let targetVersion = context.store.version(context.device);
		if (target && !TEXT_ROLES.has(target.role))
			return yield* refuse("The target is not a text field.", "none");
		if (target && !point) {
			const fresh = yield* context.observe();
			if (!fresh.view)
				return yield* refuse(
					"The target could not be checked immediately before input.",
					"none",
				);
			target = yield* Effect.try({
				try: () => revalidateTargetNode(context.store, context.device, target!),
				catch: (cause) => withActionEffect(cause, "none"),
			});
			before = fresh.view;
			targetVersion = context.store.version(context.device);
		}
		if (!selector) {
			const fresh = yield* context.observe();
			if (!fresh.view)
				return yield* refuse(
					"The focused field could not be checked immediately before input.",
					"none",
				);
			before = fresh.view;
			targetVersion = context.store.version(context.device);
		}
		const performAndInvalidate = perform
			? (request: FieldRequest) =>
					Effect.tryPromise({
						try: () => perform(request),
						catch: (cause) => withActionEffect(cause, "unknown"),
					}).pipe(
						Effect.tap(() =>
							Effect.sync(() => context.store.mutate(context.device)),
						),
						Effect.catchAll((error) =>
							Effect.sync(() => context.store.mutate(context.device)).pipe(
								Effect.andThen(Effect.fail(error)),
							),
						),
					)
			: null;
		const readFocused = (effect: ActionEffect) =>
			readFocus
				? Effect.tryPromise({
						try: () => readFocus(),
						catch: (cause) => withActionEffect(cause, effect),
					})
				: Effect.succeed(null);

		let field: DeviceField | null = null;
		let handle = "focus";
		let inputGuard: (() => void) | undefined;
		if (point) {
			yield* context.dispatch(
				[{ type: "tap", x: point.x, y: point.y }],
				() => {
					if (!context.store.isCurrent(context.device, targetVersion))
						throw new Error(
							"The device changed before dispatch. Take a screenshot again.",
						);
				},
			);
			field = yield* readFocused("unknown");
			target = nodeForIdentity(before, field?.identity);
			if (!field || !target)
				return yield* refuse(
					"The platform cannot prove which field received focus at that point.",
					"unknown",
				);
		} else if (target && performAndInvalidate) {
			if (!context.store.isCurrent(context.device, targetVersion))
				return yield* refuse(
					"The device changed before input. Run observe again.",
					"none",
				);
			const focused = yield* performAndInvalidate({
				node: target.path,
				action: "focus",
				...(target.testId ? { testId: target.testId } : {}),
				className: target.rawRole,
				identity: {
					id: target.id,
					path: target.path,
					role: target.role,
					...(target.windowId === undefined
						? {}
						: { windowId: target.windowId }),
					...(target.sourceId === undefined
						? {}
						: { sourceId: target.sourceId }),
				},
			});
			field = focused.field;
			handle = target.path;
			if (
				!field?.focused ||
				!field.identity ||
				nodeForIdentity(before, field.identity) !== target
			)
				return yield* refuse(
					"The platform could not prove that the target field received focus.",
					"unknown",
				);
		} else if (target) {
			if (!readFocus)
				return yield* refuse(
					"The platform cannot prove which field receives focus.",
					"none",
				);
			yield* context.dispatch(
				[{ type: "tap", ...pointValues(target) }],
				() => {
					if (!context.store.isCurrent(context.device, targetVersion))
						throw new Error(
							"The device changed before dispatch. Run observe again.",
						);
				},
			);
			field = yield* readFocused("unknown");
			if (
				!field?.focused ||
				!field.identity ||
				nodeForIdentity(before, field.identity) !== target
			)
				return yield* refuse(
					"The platform could not prove that the target field received focus.",
					"unknown",
				);
		} else {
			if (!readFocus)
				return yield* refuse(
					"The platform cannot prove the focused field. Give --into <ref or label>.",
					"none",
				);
			field = yield* readFocused("none");
			target = nodeForIdentity(before, field?.identity);
			if (!field?.focused || !target)
				return yield* refuse(
					"The focused field identity is unavailable. Give --into <ref or label>.",
					"none",
				);
			inputGuard = () => {
				if (!context.store.isCurrent(context.device, targetVersion))
					throw new Error(
						"The device changed before input. Run observe again.",
					);
			};
		}

		if (!target || !TEXT_ROLES.has(target.role))
			return yield* refuse("The target is not a text field.", "none");
		if (!field?.focused || !field.identity)
			return yield* refuse(
				"The platform cannot prove the focused field.",
				"unknown",
			);
		if (field && !field.focused)
			return yield* refuse(
				`${describeAxNode(target)} did not take focus. Run observe again.`,
				"unknown",
			);
		if (field && !field.editable)
			return yield* refuse(
				`${describeAxNode(target)} is not editable.`,
				"unknown",
			);

		const protectedValue = field?.password === true || target.role === "securetextbox";
		const expected = protectedValue
			? null
			: operation === "fill"
				? action.text
				: expectedTypedValue(field, action.text);
		if (nativeFill && performAndInvalidate) {
			const written = yield* performAndInvalidate({
				node: handle,
				action: "set-text",
				text: action.text,
				identity: field.identity,
			});
			if (!written.performed)
				return yield* refuse("The field refused the replacement.", "unknown");
		} else {
			yield* context.dispatch(
				operation === "fill"
					? [
							{ type: "key", key: "select-all" },
							{ type: "key", key: "delete" },
							{ type: "type", text: action.text },
						]
					: [{ type: "type", text: action.text }],
				inputGuard,
			);
		}

		const observed = yield* context.observe();
		const found = observed.view ? sameNode(observed.view, target) : null;
		const focusedAfter = yield* readFocused("unknown").pipe(
			Effect.match({
				onFailure: () => null,
				onSuccess: (value) => value,
			}),
		);
		const targetConfirmed =
			found !== null &&
			focusedAfter?.focused === true &&
			nodeForIdentity(observed.view, focusedAfter.identity) === found;
		const verification = verificationFor({
			operation,
			expected,
			field: found,
			targetConfirmed,
			protectedValue,
		});
		let submit: TextSubmitResult = {
			requested: false,
			status: "not_requested",
			reason: "Submit was not requested.",
		};
		if (action.submit) {
			if (verification.status !== "matched")
				submit = {
					requested: true,
					status: "suppressed",
					reason: `Submit was suppressed. ${verification.reason}`,
				};
			else if (!targetConfirmed)
				submit = {
					requested: true,
					status: "suppressed",
					reason: "Submit was suppressed because the target field was not confirmed.",
				};
			else {
				const submitted = yield* context
					.dispatch([{ type: "key", key: "enter" }])
					.pipe(
						Effect.match({
							onFailure: (error) => ({ ok: false as const, error }),
							onSuccess: () => ({ ok: true as const }),
						}),
					);
				submit = submitted.ok
					? {
							requested: true,
							status: "accepted",
							reason: "The device accepted one Return key.",
						}
					: {
							requested: true,
							status: "unknown",
							reason: submitted.error.message,
						};
			}
		}

		const resolvedTarget = found ?? target;
		return {
			entry: {
				operation,
				text: action.text,
				expected,
				value: protectedValue ? null : (found?.value ?? null),
				target: action.into ?? null,
				field: found ? lineOf(found) : null,
				submit,
			},
			verification,
			resolved: [
				{
					type: "type",
					text: action.text,
					cleared: operation === "fill",
					value: protectedValue ? null : (found?.value ?? null),
					into: {
						...nodePoint(resolvedTarget),
						label: resolvedTarget.label,
					},
				},
				...(submit.status === "accepted"
					? [{ type: "key" as const, key: "enter" }]
					: []),
			],
			view: observed.view,
			warnings: observed.warnings,
			dispatch: submit.status === "unknown" ? "unknown" : "accepted",
			dispatchReason:
				submit.status === "unknown"
					? submit.reason
					: "The device accepted the input operation.",
		};
	});
}
