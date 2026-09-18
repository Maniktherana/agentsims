import { Duration, Effect } from "effect";
import { z } from "zod";
import type { ActionOptions, ActionResult } from "./actions";
import { InvalidCommandInput, type ApplicationCommandError } from "./errors";
import { DEVICE_BUTTONS } from "./input";
import { AX_ROLES } from "./observe/ax-view";
import type { DeviceObservation, ObserveOptions } from "./observe/observe";
import { isPointTarget } from "./observe/targets";

/** A sequence is a short, sanctioned chain. Longer work needs its own plan. */
export const MAX_SEQUENCE_STEPS = 25;
/** A wait holds the device. It must never hold it for long. */
export const MAX_WAIT_MS = 10_000;
/** How long the screen gets to settle after an accepted step. */
export const SETTLE_MS = 400;

const REF_MESSAGE = "refs are not stable across steps; use labels";
const CAPTURE_MESSAGE =
	"capture IDs are not stable across steps; use labels or percent points";
const PIXEL_MESSAGE =
	"pixel points need a capture ID, which is not stable across steps; use labels or percent points";

const PERCENT_POINT = /^-?\d+(?:\.\d+)?%,-?\d+(?:\.\d+)?%$/;

const label = z.string().min(1).optional();
const duration = z.number().int().positive().max(5_000).optional();
const selector = {
	capture: z.string().min(1).optional(),
	role: z.enum(AX_ROLES).optional(),
	index: z.number().int().positive().optional(),
};
const text = {
	text: z.string(),
	into: z.string().min(1).optional(),
	submit: z.boolean().optional(),
	clear: z.boolean().optional(),
};

export const SequenceStepSchema = z.discriminatedUnion("type", [
	z
		.object({ type: z.literal("tap"), target: z.string().min(1), ...selector, label })
		.strict(),
	z
		.object({
			type: z.literal("long-press"),
			target: z.string().min(1),
			durationMs: duration,
			...selector,
			label,
		})
		.strict(),
	z
		.object({
			type: z.literal("swipe"),
			from: z.string().min(1),
			to: z.string().min(1),
			durationMs: duration,
			...selector,
			label,
		})
		.strict(),
	z.object({ type: z.literal("type"), ...text, ...selector, label }).strict(),
	z.object({ type: z.literal("fill"), ...text, ...selector, label }).strict(),
	z
		.object({ type: z.literal("button"), button: z.enum(DEVICE_BUTTONS), label })
		.strict(),
	z
		.object({
			type: z.literal("wait"),
			ms: z.number().int().positive().max(MAX_WAIT_MS),
			label,
		})
		.strict(),
]);
export type SequenceStep = z.infer<typeof SequenceStepSchema>;
export type SequenceWait = Extract<SequenceStep, { type: "wait" }>;
export type SequenceInput = Exclude<SequenceStep, SequenceWait>;

function isPercentPoint(target: string): boolean {
	return PERCENT_POINT.test(target.trim().replace(/\s+/g, ""));
}

/** Says why a target cannot survive to the next step, or null when it can. */
function targetProblem(value: string): string | null {
	const target = value.trim();
	if (target.startsWith("@")) return REF_MESSAGE;
	if (isPointTarget(target) && !isPercentPoint(target)) return PIXEL_MESSAGE;
	return null;
}

/** The target strings a step resolves, by field name. */
function targetsOf(step: SequenceStep): Array<[string, string]> {
	switch (step.type) {
		case "swipe":
			return [
				["from", step.from],
				["to", step.to],
			];
		case "type":
		case "fill":
			return step.into ? [["into", step.into]] : [];
		case "button":
		case "wait":
			return [];
		default:
			return [["target", step.target]];
	}
}

/** Refs and capture IDs belong to one observation. A sequence re-observes. */
export const SequenceStepsSchema = z
	.array(SequenceStepSchema)
	.min(1, "A sequence needs at least one step")
	.max(MAX_SEQUENCE_STEPS, `A sequence takes at most ${MAX_SEQUENCE_STEPS} steps`)
	.superRefine((steps, context) => {
		steps.forEach((step, index) => {
			const reject = (key: string, message: string) =>
				context.addIssue({
					code: z.ZodIssueCode.custom,
					message,
					path: [index, key],
				});
			if ("capture" in step && step.capture !== undefined)
				reject("capture", CAPTURE_MESSAGE);
			for (const [key, value] of targetsOf(step)) {
				const problem = targetProblem(value);
				if (problem) reject(key, problem);
			}
		});
	});

function issueMessage(error: z.ZodError): string {
	const issue = error.issues[0];
	if (!issue) return "The step list is invalid";
	const [first, ...rest] = issue.path;
	const where =
		typeof first === "number"
			? `step ${first + 1}${rest.length > 0 ? ` ${rest.join(".")}` : ""}: `
			: issue.path.length > 0
				? `${issue.path.join(".")}: `
				: "";
	return `${where}${issue.message}`;
}

/** Parses a step list and reports the first problem in CLI-ready words. */
export function parseSequenceSteps(value: unknown): SequenceStep[] {
	const parsed = SequenceStepsSchema.safeParse(value);
	if (parsed.success) return parsed.data;
	throw new InvalidCommandInput({
		message: issueMessage(parsed.error),
		effect: "none",
		cause: parsed.error,
	});
}

export function parseSequence(
	value: unknown,
): Effect.Effect<SequenceStep[], InvalidCommandInput> {
	return Effect.try({
		try: () => parseSequenceSteps(value),
		catch: (cause) =>
			cause instanceof InvalidCommandInput
				? cause
				: new InvalidCommandInput({
						message: cause instanceof Error ? cause.message : String(cause),
						effect: "none",
						cause,
					}),
	});
}

export type SequenceStepResult = {
	index: number;
	label?: string;
	action: SequenceStep;
	result: ActionResult;
};

export type SequenceResult = {
	device: string;
	steps: SequenceStepResult[];
	/** The zero-based index of the step that stopped the run. */
	stoppedAt: number | null;
	completed: number;
	/** How many steps the request asked for, including the ones never run. */
	total: number;
};

/** The device operations a sequence needs. The device service supplies them. */
export type SequenceDeviceOperations = {
	observe(
		device: string,
		options?: ObserveOptions,
	): Effect.Effect<DeviceObservation, ApplicationCommandError>;
	act(
		device: string,
		values: ReadonlyArray<unknown>,
		options?: ActionOptions,
	): Effect.Effect<ActionResult, ApplicationCommandError>;
};

export type SequenceOptions = ActionOptions & {
	/** Tests inject this to keep the settle and the wait steps instant. */
	sleep?: (milliseconds: number) => Effect.Effect<void>;
};

/** Drops the output-only label and turns `fill` into a clearing `type`. */
export function actionRequest(step: SequenceInput): unknown {
	const { label: _label, ...rest } = step;
	if (rest.type !== "fill") return rest;
	const { type: _type, ...fields } = rest;
	return { type: "type", ...fields, clear: true };
}

export function describeSequenceStep(step: SequenceStep): string {
	const show = (target: string) =>
		isPointTarget(target) ? target.trim() : JSON.stringify(target);
	switch (step.type) {
		case "long-press":
			return `long-press ${show(step.target)}${
				step.durationMs === undefined ? "" : ` ${step.durationMs}ms`
			}`;
		case "swipe":
			return `swipe ${show(step.from)} to ${show(step.to)}`;
		case "type":
		case "fill":
			return `${step.type} ${JSON.stringify(step.text)}${
				step.into ? ` into ${show(step.into)}` : ""
			}`;
		case "button":
			return `press ${step.button}`;
		case "wait":
			return `wait ${step.ms}ms`;
		default:
			return `tap ${show(step.target)}`;
	}
}

function waitResult(
	device: string,
	step: SequenceWait,
	observation: DeviceObservation,
): ActionResult {
	return {
		device,
		dispatch: { status: "accepted", reason: `Waited ${step.ms} ms` },
		verification: {
			status: "not_applicable",
			reason: "A wait sends no input",
			observed: null,
		},
		resolved: [],
		accessibility: observation.accessibility,
		view: observation.view,
		image: null,
		captureReason: null,
		warnings: observation.warnings,
	};
}

/**
 * Runs label-addressed steps one at a time. Every input step observes the
 * device first, so a target resolves against the tree that the last step left.
 * The run stops at the first step that the device did not accept.
 */
export function runSequence(
	operations: SequenceDeviceOperations,
	device: string,
	values: unknown,
	options: SequenceOptions = {},
): Effect.Effect<SequenceResult, ApplicationCommandError> {
	return Effect.gen(function* () {
		const steps = yield* parseSequence(values);
		const sleep =
			options.sleep ??
			((milliseconds: number) => Effect.sleep(Duration.millis(milliseconds)));
		const screenshot = options.screenshot === true;
		const results: SequenceStepResult[] = [];
		let stoppedAt: number | null = null;
		let completed = 0;
		for (const [index, step] of steps.entries()) {
			let result: ActionResult;
			if (step.type === "wait") {
				yield* sleep(Math.min(step.ms, MAX_WAIT_MS));
				result = waitResult(
					device,
					step,
					yield* operations.observe(device, { screenshot: false }),
				);
			} else {
				yield* operations.observe(device, { screenshot: false });
				result = yield* operations.act(device, [actionRequest(step)], {
					screenshot,
				});
			}
			results.push({
				index,
				...(step.label ? { label: step.label } : {}),
				action: step,
				result,
			});
			if (result.dispatch.status !== "accepted") {
				stoppedAt = index;
				break;
			}
			completed += 1;
			if (step.type !== "wait") yield* sleep(SETTLE_MS);
		}
		return { device, steps: results, stoppedAt, completed, total: steps.length };
	});
}
