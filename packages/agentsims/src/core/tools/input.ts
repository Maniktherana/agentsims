import {
	textToKeyEvents,
	UnsupportedCharacterError,
} from "../ios/text-to-keys";
import { Effect } from "effect";
import { z } from "zod";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "./errors";

const INPUT_TOUCH = 0x03;
const INPUT_BUTTON = 0x04;
const INPUT_KEY = 0x06;
const INPUT_ROTATE = 0x07;

const orientations = [
	"portrait",
	"portrait_upside_down",
	"landscape_left",
	"landscape_right",
] as const;

const HID_BUTTON_CODES: Record<string, { page: number; usage: number }> = {
	power: { page: 12, usage: 48 },
	"volume-up": { page: 12, usage: 233 },
	"volume-down": { page: 12, usage: 234 },
	action: { page: 11, usage: 45 },
	"side-button": { page: 12, usage: 149 },
	"digital-crown": { page: 12, usage: 64 },
	"left-side-button": { page: 65281, usage: 512 },
};

export const DEVICE_BUTTONS = [
	"home",
	"power",
	"volume-up",
	"volume-down",
	"back",
	"app-switch",
	"action",
	"side-button",
	"digital-crown",
	"left-side-button",
] as const;

const coordinate = (name: string) =>
	z
		.number({ error: `${name} must be a number between 0 and 1` })
		.finite({ error: `${name} must be a number between 0 and 1` })
		.min(0, { error: `${name} must be a number between 0 and 1` })
		.max(1, { error: `${name} must be a number between 0 and 1` });
const duration = z
	.number({ error: "durationMs must be a positive finite number" })
	.finite({ error: "durationMs must be a positive finite number" })
	.positive({ error: "durationMs must be a positive finite number" })
	.transform((value) => Math.min(5_000, Math.round(value)));
export const DeviceActionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("tap"), x: coordinate("x"), y: coordinate("y") }),
	z.object({
		type: z.literal("gesture"),
		phase: z.enum(["begin", "move", "end", "cancel"]),
		x: coordinate("x"),
		y: coordinate("y"),
	}),
	z.object({
		type: z.literal("swipe"),
		x1: coordinate("x1"),
		y1: coordinate("y1"),
		x2: coordinate("x2"),
		y2: coordinate("y2"),
		durationMs: duration.optional(),
	}),
	z.object({ type: z.literal("type"), text: z.string() }),
	z.object({ type: z.literal("button"), button: z.enum(DEVICE_BUTTONS) }),
	z.object({ type: z.literal("rotate"), orientation: z.enum(orientations) }),
]);
export type DeviceAction = z.infer<typeof DeviceActionSchema>;

export type DeviceInputSession = {
	dispatchInputFrame(data: Buffer): Promise<void>;
};

type InputStep = {
	data: Buffer;
	delayAfterMs?: number;
};

export type ResolveSession = (
	device: string,
) => Effect.Effect<DeviceInputSession, ApplicationCommandError>;
type Pause = (milliseconds: number) => Effect.Effect<void>;

function inputFrame(tag: number, payload: Record<string, unknown>): Buffer {
	return Buffer.concat([
		Buffer.from([tag]),
		Buffer.from(JSON.stringify(payload), "utf8"),
	]);
}

function stepsForAction(action: DeviceAction): InputStep[] {
	switch (action.type) {
		case "tap":
			return [
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "begin",
						x: action.x,
						y: action.y,
					}),
					delayAfterMs: 40,
				},
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "end",
						x: action.x,
						y: action.y,
					}),
				},
			];
		case "gesture":
			return [
				{
					data: inputFrame(INPUT_TOUCH, {
						type: action.phase,
						x: action.x,
						y: action.y,
					}),
				},
			];
		case "swipe": {
			const delayAfterMs = Math.round((action.durationMs ?? 220) / 2);
			return [
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "begin",
						x: action.x1,
						y: action.y1,
					}),
					delayAfterMs,
				},
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "move",
						x: action.x2,
						y: action.y2,
					}),
					delayAfterMs,
				},
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "end",
						x: action.x2,
						y: action.y2,
					}),
				},
			];
		}
		case "type":
			try {
				return textToKeyEvents(action.text).map((event) => ({
					data: inputFrame(INPUT_KEY, event),
					delayAfterMs: 4,
				}));
			} catch (error) {
				if (error instanceof UnsupportedCharacterError) {
					throw new Error(
						`${error.message}. Only US-keyboard ASCII characters are supported.`,
					);
				}
				throw error;
			}
		case "button": {
			const hid = HID_BUTTON_CODES[action.button];
			return [
				{
					data: inputFrame(
						INPUT_BUTTON,
						hid ? { button: action.button, ...hid } : { button: action.button },
					),
				},
			];
		}
		case "rotate":
			return [
				{ data: inputFrame(INPUT_ROTATE, { orientation: action.orientation }) },
			];
	}
}

function defaultPause(milliseconds: number): Effect.Effect<void> {
	return Effect.sleep(`${milliseconds} millis`);
}

export function decodeDeviceAction(value: unknown): DeviceAction {
	if (!value || typeof value !== "object")
		throw new Error("Action must be a JSON object");
	return DeviceActionSchema.parse(value);
}

export function parseDeviceAction(value: string): DeviceAction {
	try {
		return decodeDeviceAction(JSON.parse(value));
	} catch (error) {
		if (error instanceof SyntaxError)
			throw new Error("Action must be valid JSON");
		throw error;
	}
}

export function makeDeviceActions(
	resolveSession: ResolveSession,
	pause: Pause = defaultPause,
) {
	return (
		device: string,
		values: ReadonlyArray<unknown>,
	): Effect.Effect<void, ApplicationCommandError> => {
		return Effect.gen(function* () {
			if (!device)
				return yield* Effect.fail(
					new InvalidCommandInput({ message: "Invalid or missing device" }),
				);
			if (values.length === 0) {
				return yield* Effect.fail(
					new InvalidCommandInput({
						message: "At least one action is required",
					}),
				);
			}
			const actions = yield* Effect.try({
				try: () => values.map(decodeDeviceAction),
				catch: commandFailure,
			});
			const session = yield* resolveSession(device);
			for (const action of actions) {
				for (const step of stepsForAction(action)) {
					yield* Effect.tryPromise({
						try: () => session.dispatchInputFrame(step.data),
						catch: commandFailure,
					});
					if (step.delayAfterMs) {
						yield* pause(step.delayAfterMs);
					}
				}
			}
		});
	};
}
