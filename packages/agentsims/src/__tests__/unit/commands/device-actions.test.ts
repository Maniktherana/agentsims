import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  decodeDeviceAction,
  DeviceActionCommands,
  parseDeviceAction,
} from "../../../commands/device-actions";

function decodedFrame(data: Buffer): { tag: number; payload: Record<string, unknown> } {
  return {
    tag: data[0]!,
    payload: JSON.parse(data.subarray(1).toString("utf8")),
  };
}

describe("DeviceActionCommands", () => {
  test("paces a swipe on the server and dispatches ordered input", async () => {
    const frames: Buffer[] = [];
    const delays: number[] = [];
    const commands = new DeviceActionCommands(
      async () => ({
        dispatchInputFrame: async (data) => {
          frames.push(data);
        },
      }),
      (milliseconds) => Effect.sync(() => {
        delays.push(milliseconds);
      }),
    );

    await Effect.runPromise(commands.act("android:emulator-5554", [{
      type: "swipe",
      x1: 0.5,
      y1: 0.8,
      x2: 0.5,
      y2: 0.2,
      durationMs: 240,
    }]));

    expect(frames.map(decodedFrame)).toEqual([
      { tag: 0x03, payload: { type: "begin", x: 0.5, y: 0.8 } },
      { tag: 0x03, payload: { type: "move", x: 0.5, y: 0.2 } },
      { tag: 0x03, payload: { type: "end", x: 0.5, y: 0.2 } },
    ]);
    expect(delays).toEqual([120, 120]);
  });

  test("rejects the whole batch before it dispatches an invalid action", async () => {
    const frames: Buffer[] = [];
    const commands = new DeviceActionCommands(async () => ({
      dispatchInputFrame: async (data) => {
        frames.push(data);
      },
    }));

    await expect(Effect.runPromise(commands.act("ios-device", [
      { type: "tap", x: 0.5, y: 0.5 },
      { type: "tap", x: 2, y: 0.5 },
    ]))).rejects.toThrow("x must be a number between 0 and 1");
    expect(frames).toHaveLength(0);
  });

  test("parses supported actions and bounds swipe duration", () => {
    expect(parseDeviceAction('{"type":"rotate","orientation":"landscape_left"}')).toEqual({
      type: "rotate",
      orientation: "landscape_left",
    });
    expect(decodeDeviceAction({
      type: "swipe",
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      durationMs: 60_000,
    })).toMatchObject({ durationMs: 5_000 });
  });
});
