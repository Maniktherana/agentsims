import {
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { dirname, join, resolve } from "path";
import {
  sendKeyEventsToWs,
  textToKeyEvents,
  UnsupportedCharacterError,
} from "../shared/text-to-keys";
import { STATE_DIR, type DeviceState } from "../shared/state";
import { readState } from "./device-state";

const WS_MSG_TOUCH = 0x03;
const WS_MSG_BUTTON = 0x04;
const WS_MSG_ROTATE = 0x07;
const VALID_ORIENTATIONS = new Set([
  "portrait",
  "portrait_upside_down",
  "landscape_left",
  "landscape_right",
]);

const HID_BUTTON_CODES: Record<string, { page: number; usage: number }> = {
  power: { page: 12, usage: 48 },
  "volume-up": { page: 12, usage: 233 },
  "volume-down": { page: 12, usage: 234 },
  action: { page: 11, usage: 45 },
  "side-button": { page: 12, usage: 149 },
  "digital-crown": { page: 12, usage: 64 },
  "left-side-button": { page: 65281, usage: 512 },
};

type InputMessage = {
  tag: number;
  payload: Record<string, unknown>;
  delayAfterMs?: number;
};

type TapAction = { type: "tap"; x: number; y: number };
type GestureAction = {
  type: "gesture";
  phase: "begin" | "move" | "end" | "cancel";
  x: number;
  y: number;
};
type SwipeAction = {
  type: "swipe";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
};
type TypeAction = { type: "type"; text: string };
type ButtonAction = { type: "button"; button: string };
type RotateAction = { type: "rotate"; orientation: string };

export type AgentAction =
  | TapAction
  | GestureAction
  | SwipeAction
  | TypeAction
  | ButtonAction
  | RotateAction;

export type Observation = {
  device: string;
  platform: "ios" | "android";
  capturedAt: number;
  screenshot: {
    path: string;
    mimeType: string;
    bytes: number;
  };
  config: unknown;
  accessibility: unknown;
  warnings: string[];
};

function requireState(device?: string): DeviceState {
  const state = readState(device);
  if (!state) {
    throw new Error(
      "No matching Agentsims device is running. Start `agentsims` and use `agentsims --list` to find its device id.",
    );
  }
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalized(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a number between 0 and 1`);
  }
  return value;
}

function inputFrame(tag: number, payload: Record<string, unknown>): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(payload));
  const message = new Uint8Array(1 + json.length);
  message[0] = tag;
  message.set(json, 1);
  return message;
}

async function sendInputMessages(
  wsUrl: string,
  messages: InputMessage[],
): Promise<void> {
  return new Promise<void>((resolvePromise, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    ws.onopen = async () => {
      try {
        for (const message of messages) {
          ws.send(inputFrame(message.tag, message.payload));
          if (message.delayAfterMs) await sleep(message.delayAfterMs);
        }
        setTimeout(() => {
          ws.close();
          resolvePromise();
        }, 50);
      } catch (error) {
        ws.close();
        reject(error);
      }
    };
    ws.onerror = () => reject(new Error(`WebSocket connection failed: ${wsUrl}`));
  });
}

export function helperUrl(
  state: DeviceState,
  endpoint: "screenshot.png" | "config" | "ax",
  options: { axMode?: "latest" | "fresh" | "settled" } = {},
): string {
  const url = new URL(state.wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.replace(/\/ws$/, `/${endpoint}`);
  url.search = "";
  if (endpoint === "ax" && options.axMode) {
    url.searchParams.set("mode", options.axMode);
  }
  url.hash = "";
  return url.toString();
}

async function readJsonResponse(
  state: DeviceState,
  endpoint: "config" | "ax",
  warnings: string[],
  request: typeof fetch = fetch,
): Promise<unknown> {
  try {
    const response = await request(helperUrl(
      state,
      endpoint,
      endpoint === "ax" ? { axMode: "settled" } : {},
    ));
    if (!response.ok) {
      warnings.push(`${endpoint} unavailable (${response.status})`);
      return null;
    }
    return await response.json();
  } catch (error) {
    warnings.push(
      `${endpoint} unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export async function captureObservationPayloads(
  state: DeviceState,
  includeAccessibility: boolean,
  warnings: string[],
  request: typeof fetch = fetch,
): Promise<{
  screenshotResponse: Response;
  config: unknown;
  accessibility: unknown;
}> {
  // Agent observations intentionally trade a little latency for coherence:
  // first obtain AX after the helper's bounded idle barrier, then capture the
  // screenshot and configuration immediately. Browser review never calls this
  // path; its explicit `fresh` snapshots have no idle wait.
  const accessibility = includeAccessibility
    ? await readJsonResponse(state, "ax", warnings, request)
    : null;
  const [screenshotResponse, config] = await Promise.all([
    request(helperUrl(state, "screenshot.png")),
    readJsonResponse(state, "config", warnings, request),
  ]);
  return { screenshotResponse, config, accessibility };
}

function screenshotExtension(mimeType: string): string {
  return mimeType.includes("png") ? ".png" : ".jpg";
}

function safeDeviceName(device: string): string {
  return device.replace(/[^0-9A-Za-z._-]+/g, "-");
}

export async function observeDevice(options: {
  device?: string;
  output?: string;
  includeAccessibility?: boolean;
}): Promise<Observation> {
  const state = requireState(options.device);
  const warnings: string[] = [];
  const { screenshotResponse, config, accessibility } =
    await captureObservationPayloads(
      state,
      options.includeAccessibility !== false,
      warnings,
    );

  if (!screenshotResponse.ok) {
    throw new Error(
      `Screenshot unavailable (${screenshotResponse.status}): ${await screenshotResponse.text()}`,
    );
  }
  const mimeType =
    screenshotResponse.headers.get("content-type")?.split(";", 1)[0] ??
    "application/octet-stream";
  const screenshot = Buffer.from(await screenshotResponse.arrayBuffer());
  const output = options.output
    ? resolve(options.output)
    : join(
        STATE_DIR,
        "observations",
        `${safeDeviceName(state.device)}-latest${screenshotExtension(mimeType)}`,
      );
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, screenshot);

  return {
    device: state.device,
    platform: state.device.startsWith("android:") ? "android" : "ios",
    capturedAt: Date.now(),
    screenshot: {
      path: output,
      mimeType,
      bytes: screenshot.length,
    },
    config,
    accessibility,
    warnings,
  };
}

export function parseAgentAction(value: string): AgentAction {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Action must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Action must be a JSON object");
  }
  const action = parsed as Record<string, unknown>;
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
      if (typeof action.text !== "string") {
        throw new Error("type action requires text");
      }
      return { type: "type", text: action.text };
    case "button":
      if (typeof action.button !== "string" || !action.button) {
        throw new Error("button action requires button");
      }
      return { type: "button", button: action.button };
    case "rotate":
      if (
        typeof action.orientation !== "string" ||
        !VALID_ORIENTATIONS.has(action.orientation)
      ) {
        throw new Error(
          `orientation must be one of ${[...VALID_ORIENTATIONS].join(", ")}`,
        );
      }
      return { type: "rotate", orientation: action.orientation };
    default:
      throw new Error(
        "Unsupported action type. Use tap, gesture, swipe, type, button, or rotate.",
      );
  }
}

export async function actOnDevice(
  action: AgentAction,
  device?: string,
): Promise<void> {
  const state = requireState(device);
  switch (action.type) {
    case "tap":
      await sendInputMessages(state.wsUrl, [
        {
          tag: WS_MSG_TOUCH,
          payload: { type: "begin", x: action.x, y: action.y },
          delayAfterMs: 40,
        },
        {
          tag: WS_MSG_TOUCH,
          payload: { type: "end", x: action.x, y: action.y },
        },
      ]);
      return;
    case "gesture":
      await sendInputMessages(state.wsUrl, [
        {
          tag: WS_MSG_TOUCH,
          payload: {
            type: action.phase,
            x: action.x,
            y: action.y,
          },
        },
      ]);
      return;
    case "swipe": {
      const durationMs = action.durationMs ?? 220;
      await sendInputMessages(state.wsUrl, [
        {
          tag: WS_MSG_TOUCH,
          payload: { type: "begin", x: action.x1, y: action.y1 },
          delayAfterMs: Math.round(durationMs / 2),
        },
        {
          tag: WS_MSG_TOUCH,
          payload: { type: "move", x: action.x2, y: action.y2 },
          delayAfterMs: Math.round(durationMs / 2),
        },
        {
          tag: WS_MSG_TOUCH,
          payload: { type: "end", x: action.x2, y: action.y2 },
        },
      ]);
      return;
    }
    case "type":
      try {
        await sendKeyEventsToWs(state.wsUrl, textToKeyEvents(action.text));
      } catch (error) {
        if (error instanceof UnsupportedCharacterError) {
          throw new Error(
            `${error.message}. Only US-keyboard ASCII characters are supported.`,
          );
        }
        throw error;
      }
      return;
    case "button": {
      const hid = HID_BUTTON_CODES[action.button];
      await sendInputMessages(state.wsUrl, [
        {
          tag: WS_MSG_BUTTON,
          payload: hid
            ? { button: action.button, ...hid }
            : { button: action.button },
        },
      ]);
      return;
    }
    case "rotate":
      await sendInputMessages(state.wsUrl, [
        {
          tag: WS_MSG_ROTATE,
          payload: { orientation: action.orientation },
        },
      ]);
      return;
  }
}

export async function gesture(json: string, device?: string): Promise<void> {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  await actOnDevice(
    parseAgentAction(
      JSON.stringify({
        type: "gesture",
        phase: parsed.type,
        x: parsed.x,
        y: parsed.y,
      }),
    ),
    device,
  );
}

export async function tap(
  xValue: string,
  yValue: string,
  device?: string,
): Promise<void> {
  await actOnDevice(
    {
      type: "tap",
      x: normalized(Number(xValue), "x"),
      y: normalized(Number(yValue), "y"),
    },
    device,
  );
}

export async function typeText(
  positional: string[],
  options: { device?: string; stdin?: boolean; file?: string },
): Promise<void> {
  const sources = [
    positional.length > 0,
    options.stdin === true,
    options.file !== undefined,
  ].filter(Boolean).length;
  if (sources !== 1) {
    throw new Error(
      "Provide text as arguments, with --stdin, or with --file <path>.",
    );
  }
  const text = options.stdin
    ? readFileSync(0, "utf8")
    : options.file
      ? readFileSync(options.file, "utf8")
      : positional.join(" ");
  await actOnDevice({ type: "type", text }, options.device);
}

export async function rotate(
  orientation: string,
  device?: string,
): Promise<void> {
  await actOnDevice(
    parseAgentAction(JSON.stringify({ type: "rotate", orientation })),
    device,
  );
}

export async function button(
  name = "home",
  device?: string,
): Promise<void> {
  await actOnDevice({ type: "button", button: name }, device);
}
