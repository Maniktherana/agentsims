import {
	editKeyEvents,
	EDIT_KEYS,
	textToKeyEvents,
	UnsupportedCharacterError,
} from "../ios/text-to-keys";
import { androidSerialFromStateId } from "../android/device/identifiers";
import { Effect } from "effect";
import { z } from "zod";
import {
	InvalidCommandInput,
	withActionEffect,
	type ApplicationCommandError,
} from "./errors";

const INPUT_TOUCH = 0x03;
const INPUT_BUTTON = 0x04;
const INPUT_KEY = 0x06;
const INPUT_ROTATE = 0x07;

export const DEVICE_ORIENTATIONS = [
	"portrait",
	"portrait_upside_down",
	"landscape_left",
	"landscape_right",
] as const;

export const GESTURE_PHASES = ["begin", "move", "end", "cancel"] as const;

export const ANDROID_DEVICE_BUTTONS = [
	"home",
	"power",
	"volume-up",
	"volume-down",
	"back",
	"app-switch",
] as const;

export const IOS_DEVICE_BUTTONS = [
	"home",
	"power",
	"volume-up",
	"volume-down",
	"app-switcher",
	"action",
	"side-button",
	"digital-crown",
	"left-side-button",
] as const;

export const DEVICE_BUTTONS = [
	...ANDROID_DEVICE_BUTTONS,
	"app-switcher",
	"action",
	"side-button",
	"digital-crown",
	"left-side-button",
] as const;

type DeviceButton = (typeof DEVICE_BUTTONS)[number];
type DevicePlatform = "android" | "ios";
type NativeButton = { button: string; page?: number; usage?: number };

const NATIVE_BUTTONS: Record<
	DevicePlatform,
	Partial<Record<DeviceButton, NativeButton>>
> = {
	android: {
		home: { button: "home" },
		power: { button: "power" },
		"volume-up": { button: "volume_up" },
		"volume-down": { button: "volume_down" },
		back: { button: "back" },
		"app-switch": { button: "app_switch" },
	},
	ios: {
		home: { button: "home" },
		power: { button: "power", page: 12, usage: 48 },
		"volume-up": { button: "volume_up", page: 12, usage: 233 },
		"volume-down": { button: "volume_down", page: 12, usage: 234 },
		"app-switcher": { button: "app_switcher" },
		action: { button: "action", page: 11, usage: 45 },
		"side-button": { button: "side_button", page: 12, usage: 149 },
		"digital-crown": { button: "digital_crown", page: 12, usage: 64 },
		"left-side-button": {
			button: "left_side_button",
			page: 65281,
			usage: 512,
		},
	},
};

function devicePlatform(device: string): DevicePlatform {
	return androidSerialFromStateId(device) ? "android" : "ios";
}

function buttonList(values: readonly string[]): string {
	return `${values.slice(0, -1).join(", ")}, or ${values.at(-1)}`;
}

function buttonForPlatform(
	platform: DevicePlatform,
	value: string,
): DeviceButton {
	const values =
		platform === "android" ? ANDROID_DEVICE_BUTTONS : IOS_DEVICE_BUTTONS;
	if ((values as readonly string[]).includes(value)) return value as DeviceButton;
	const label = platform === "android" ? "Android" : "iOS";
	throw new Error(
		`Button "${value}" is not available on ${label}. Use ${buttonList(values)}.`,
	);
}

export function validateDeviceButton(
	device: string,
	value: string,
): DeviceButton {
	return buttonForPlatform(devicePlatform(device), value);
}

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
export const DEFAULT_LONG_PRESS_DURATION_MS = 600;
export const DeviceActionSchema = z.discriminatedUnion("type", [
	z.object({ type: z.literal("tap"), x: coordinate("x"), y: coordinate("y") }),
	z.object({
		type: z.literal("long-press"),
		x: coordinate("x"),
		y: coordinate("y"),
		durationMs: duration.optional(),
	}),
	z.object({
		type: z.literal("gesture"),
		phase: z.enum(GESTURE_PHASES),
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
	z.object({ type: z.literal("key"), key: z.enum(EDIT_KEYS) }),
	z.object({ type: z.literal("button"), button: z.enum(DEVICE_BUTTONS) }),
	z.object({ type: z.literal("rotate"), orientation: z.enum(DEVICE_ORIENTATIONS) }),
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
export type Pause = (milliseconds: number) => Effect.Effect<void>;

function inputFrame(tag: number, payload: Record<string, unknown>): Buffer {
	return Buffer.concat([
		Buffer.from([tag]),
		Buffer.from(JSON.stringify(payload), "utf8"),
	]);
}

function stepsForAction(
	action: DeviceAction,
	platform: DevicePlatform,
): InputStep[] {
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
		case "long-press":
			return [
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "begin",
						x: action.x,
						y: action.y,
					}),
					delayAfterMs:
						action.durationMs ?? DEFAULT_LONG_PRESS_DURATION_MS,
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
			const durationMs = action.durationMs ?? 220;
			const moveCount = Math.max(1, Math.ceil(durationMs / 16));
			const timestamp = (index: number) =>
				Math.round((durationMs * index) / moveCount);
			const steps: InputStep[] = [
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "begin",
						x: action.x1,
						y: action.y1,
					}),
					delayAfterMs: timestamp(1),
				},
			];
			for (let index = 1; index <= moveCount; index += 1) {
				const progress = index / moveCount;
				const x = index === moveCount
					? action.x2
					: action.x1 + (action.x2 - action.x1) * progress;
				const y = index === moveCount
					? action.y2
					: action.y1 + (action.y2 - action.y1) * progress;
				steps.push({
					data: inputFrame(INPUT_TOUCH, {
						type: "move",
						x,
						y,
					}),
					...(index < moveCount
						? { delayAfterMs: timestamp(index + 1) - timestamp(index) }
						: {}),
				});
			}
			steps.push(
				{
					data: inputFrame(INPUT_TOUCH, {
						type: "end",
						x: action.x2,
						y: action.y2,
					}),
				},
			);
			return steps;
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
		case "key":
			return editKeyEvents(action.key).map((event) => ({
				data: inputFrame(INPUT_KEY, event),
				delayAfterMs: 4,
			}));
		case "button": {
			const button = buttonForPlatform(platform, action.button);
			const native = NATIVE_BUTTONS[platform][button]!;
			return [
				{
					data: inputFrame(INPUT_BUTTON, native),
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
		beforeDispatch?: () => void,
	): Effect.Effect<DeviceAction[], ApplicationCommandError> => {
		return Effect.gen(function* () {
			if (!device)
				return yield* Effect.fail(
					new InvalidCommandInput({
						message: "Invalid or missing device",
						effect: "none",
					}),
				);
			if (values.length === 0) {
				return yield* Effect.fail(
					new InvalidCommandInput({
						message: "At least one action is required",
						effect: "none",
					}),
				);
			}
			// Every frame is built before the first one leaves, so a refused
			// action cannot stop a batch that already reached the device.
			const actions = yield* Effect.try({
				try: () => values.map(decodeDeviceAction),
				catch: (cause) => withActionEffect(cause, "none"),
			});
			const platform = devicePlatform(device);
			const steps = yield* Effect.try({
				try: () => actions.map((action) => stepsForAction(action, platform)),
				catch: (cause) => withActionEffect(cause, "none"),
			});
			const session = yield* resolveSession(device).pipe(
				Effect.mapError((error) => withActionEffect(error, "none")),
			);
			if (beforeDispatch)
				yield* Effect.try({
					try: beforeDispatch,
					catch: (cause) => withActionEffect(cause, "none"),
				});
			for (const action of steps) {
				for (const step of action) {
					yield* Effect.tryPromise({
						try: () => session.dispatchInputFrame(step.data),
						catch: (cause) => withActionEffect(cause, "unknown"),
					});
					if (step.delayAfterMs) {
						yield* pause(step.delayAfterMs);
					}
				}
			}
			return actions;
		});
	};
}
