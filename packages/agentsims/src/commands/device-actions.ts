import {
	textToKeyEvents,
	UnsupportedCharacterError,
} from "../shared/text-to-keys";
import { Effect } from "effect";
import {
	commandFailure,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "./errors";

const INPUT_TOUCH = 0x03;
const INPUT_BUTTON = 0x04;
const INPUT_KEY = 0x06;
const INPUT_ROTATE = 0x07;

const VALID_ORIENTATIONS: Record<string, true> = {
	portrait: true,
	portrait_upside_down: true,
	landscape_left: true,
	landscape_right: true,
};

const HID_BUTTON_CODES: Record<string, { page: number; usage: number }> = {
	power: { page: 12, usage: 48 },
	"volume-up": { page: 12, usage: 233 },
	"volume-down": { page: 12, usage: 234 },
	action: { page: 11, usage: 45 },
	"side-button": { page: 12, usage: 149 },
	"digital-crown": { page: 12, usage: 64 },
	"left-side-button": { page: 65281, usage: 512 },
};

export type DeviceAction =
	| { type: "tap"; x: number; y: number }
	| {
			type: "gesture";
			phase: "begin" | "move" | "end" | "cancel";
			x: number;
			y: number;
	  }
	| {
			type: "swipe";
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			durationMs?: number;
	  }
	| { type: "type"; text: string }
	| { type: "button"; button: string }
	| { type: "rotate"; orientation: string };

export type DeviceInputSession = {
	dispatchInputFrame(data: Buffer): Promise<void>;
};

type InputStep = {
	data: Buffer;
	delayAfterMs?: number;
};

export type ResolveSession = (device: string) => Promise<DeviceInputSession>;
type Pause = (milliseconds: number) => Effect.Effect<void>;

function normalized(value: unknown, name: string): number {
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > 1
	) {
		throw new Error(`${name} must be a number between 0 and 1`);
	}
	return value;
}

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
	const action = value as Record<string, unknown>;
	switch (action.type) {
		case "tap":
			return {
				type: "tap",
				x: normalized(action.x, "x"),
				y: normalized(action.y, "y"),
			};
		case "gesture": {
			if (
				action.phase !== "begin" &&
				action.phase !== "move" &&
				action.phase !== "end" &&
				action.phase !== "cancel"
			) {
				throw new Error("gesture phase must be begin, move, end, or cancel");
			}
			return {
				type: "gesture",
				phase: action.phase,
				x: normalized(action.x, "x"),
				y: normalized(action.y, "y"),
			};
		}
		case "swipe": {
			if (
				action.durationMs !== undefined &&
				(typeof action.durationMs !== "number" ||
					!Number.isFinite(action.durationMs) ||
					action.durationMs <= 0)
			) {
				throw new Error("durationMs must be a positive finite number");
			}
			return {
				type: "swipe",
				x1: normalized(action.x1, "x1"),
				y1: normalized(action.y1, "y1"),
				x2: normalized(action.x2, "x2"),
				y2: normalized(action.y2, "y2"),
				durationMs:
					typeof action.durationMs === "number"
						? Math.min(5_000, Math.round(action.durationMs))
						: undefined,
			};
		}
		case "type":
			if (typeof action.text !== "string")
				throw new Error("type action requires text");
			return { type: "type", text: action.text };
		case "button":
			if (typeof action.button !== "string" || !action.button) {
				throw new Error("button action requires button");
			}
			return { type: "button", button: action.button };
		case "rotate":
			if (
				typeof action.orientation !== "string" ||
				!VALID_ORIENTATIONS[action.orientation]
			) {
				throw new Error(
					`orientation must be one of ${Object.keys(VALID_ORIENTATIONS).join(", ")}`,
				);
			}
			return { type: "rotate", orientation: action.orientation };
		default:
			throw new Error(
				"Unsupported action type. Use tap, gesture, swipe, type, button, or rotate.",
			);
	}
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

export class DeviceActionCommands {
	constructor(
		private readonly resolveSession: ResolveSession,
		private readonly pause: Pause = defaultPause,
	) {}

	act(
		device: string,
		values: ReadonlyArray<unknown>,
	): Effect.Effect<void, ApplicationCommandError> {
		return Effect.gen(this, function* () {
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
			const session = yield* Effect.tryPromise({
				try: () => this.resolveSession(device),
				catch: commandFailure,
			});
			for (const action of actions) {
				for (const step of stepsForAction(action)) {
					yield* Effect.tryPromise({
						try: () => session.dispatchInputFrame(step.data),
						catch: commandFailure,
					});
					if (step.delayAfterMs) {
						yield* this.pause(step.delayAfterMs);
					}
				}
			}
		});
	}
}
