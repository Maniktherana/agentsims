import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  DeviceActInputSchema,
  DeviceObservationOutputSchema,
  DeviceStartInputSchema,
} from "../../../commands/schemas";
import {
  CommandConflict,
  CommandFailure,
  InvalidCommandInput,
} from "../../../commands/errors";
import { commandErrorStatus } from "../../../server/http/command";

describe("application command contracts", () => {
  test("decodes bounded start and action inputs", () => {
    expect(Schema.decodeUnknownSync(DeviceStartInputSchema)({
      device: "ios-device",
      port: 3200,
    })).toMatchObject({ device: "ios-device", port: 3200 });
    expect(Schema.decodeUnknownSync(DeviceActInputSchema)({
      device: "ios-device",
      actions: [{ type: "tap", x: 0.5, y: 0.5 }],
    }).actions).toHaveLength(1);
    expect(() => Schema.decodeUnknownSync(DeviceStartInputSchema)({
      device: "ios-device",
      port: 70_000,
    })).toThrow();
  });

  test("validates observation output at the wire boundary", () => {
    expect(Schema.decodeUnknownSync(DeviceObservationOutputSchema)({
      device: "ios-device",
      platform: "ios",
      capturedAt: 1,
      screenshot: { mimeType: "image/jpeg", contentBase64: "abc", bytes: 3 },
      config: {},
      accessibility: null,
      warnings: [],
    })).toMatchObject({ platform: "ios" });
  });

  test("maps tagged errors to one HTTP status policy", () => {
    expect(commandErrorStatus(new InvalidCommandInput({ message: "bad" }))).toBe(400);
    expect(commandErrorStatus(new CommandConflict({ message: "busy" }))).toBe(409);
    expect(commandErrorStatus(new CommandFailure({ message: "failed" }))).toBe(500);
  });
});
