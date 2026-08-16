import { androidSerialFromStateId } from "../android/device/device";
import { getAndroidSession } from "../android/session/session";
import { getDeviceSession } from "../ios/session/session";

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

  async observe(device: string, includeAccessibility = true): Promise<DeviceObservation> {
    if (!device) throw new Error("Invalid or missing device");
    const session = await this.resolveSession(device);
    const warnings: string[] = [];
    let accessibility: unknown = null;
    if (includeAccessibility) {
      try {
        accessibility = await session.readAccessibility();
      } catch (error) {
        warnings.push(
          `accessibility unavailable: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const [screenshot, config] = await Promise.all([
      session.captureScreenshot(),
      session.readConfig(),
    ]);
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
  }
}

export const deviceObservationCommands = new DeviceObservationCommands();
