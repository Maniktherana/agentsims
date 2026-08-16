import { androidSerialFromStateId } from "../android/device/device";
import { getAndroidSession } from "../android/session/session";
import { getDeviceSession } from "../ios/session/session";
import { Effect } from "effect";
import {
  commandFailure,
  InvalidCommandInput,
  type ApplicationCommandError,
} from "./errors";

export type DeviceObservation = {
  device: string;
  platform: "ios" | "android";
  capturedAt: number;
  screenshot: {
    mimeType: string;
    contentBase64: string;
    bytes: number;
  };
  config: unknown;
  accessibility: unknown;
  warnings: string[];
};

type ObservationSession = {
  platform: "ios" | "android";
  mimeType: string;
  captureScreenshot(): Promise<Buffer>;
  readConfig(): Promise<unknown>;
  readAccessibility(): Promise<unknown>;
};

type ResolveObservationSession = (device: string) => Promise<ObservationSession>;

async function defaultResolveSession(device: string): Promise<ObservationSession> {
  const androidSerial = androidSerialFromStateId(device);
  if (androidSerial) {
    const session = await getAndroidSession(androidSerial);
    return {
      platform: "android",
      mimeType: "image/png",
      captureScreenshot: () => session.captureScreenshot(),
      readConfig: () => session.readConfig(),
      readAccessibility: () => session.readAccessibility("settled"),
    };
  }

  const session = getDeviceSession(device);
  await session.start();
  return {
    platform: "ios",
    mimeType: "image/jpeg",
    captureScreenshot: () => session.captureScreenshot(),
    readConfig: async () => session.screenConfig(),
    readAccessibility: () => session.readAccessibility(),
  };
}

export class DeviceObservationCommands {
  constructor(private readonly resolveSession: ResolveObservationSession = defaultResolveSession) {}

  observe(
    device: string,
    includeAccessibility = true,
  ): Effect.Effect<DeviceObservation, ApplicationCommandError> {
    return Effect.gen(this, function*() {
      if (!device) {
        return yield* Effect.fail(new InvalidCommandInput({ message: "Invalid or missing device" }));
      }
      const session = yield* Effect.tryPromise({
        try: () => this.resolveSession(device),
        catch: commandFailure,
      });
      const warnings: string[] = [];
      let accessibility: unknown = null;
      if (includeAccessibility) {
        accessibility = yield* Effect.tryPromise({
          try: () => session.readAccessibility(),
          catch: commandFailure,
        }).pipe(
          Effect.catchAll((error) => {
            warnings.push(`accessibility unavailable: ${error.message}`);
            return Effect.succeed(null);
          }),
        );
      }
      const [screenshot, config] = yield* Effect.tryPromise({
        try: () => Promise.all([session.captureScreenshot(), session.readConfig()]),
        catch: commandFailure,
      });
      return {
        device,
        platform: session.platform,
        capturedAt: Date.now(),
        screenshot: {
          mimeType: session.mimeType,
          contentBase64: screenshot.toString("base64"),
          bytes: screenshot.byteLength,
        },
        config,
        accessibility,
        warnings,
      };
    });
  }
}

export const deviceObservationCommands = new DeviceObservationCommands();
