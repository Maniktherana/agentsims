import { describe, expect, test } from "bun:test";
import {
  androidEmulatorSupportsImage360,
  androidCameraStartupArgs,
  parseAndroidEmulatorVersion,
  parseAndroidWebcamList,
  validateAndroidCameraStartupMode,
} from "../android/device";
import { buildDeviceMediaState } from "../media/router";
import {
  readStoredMediaRoutes,
  updateStoredMediaRoute,
  writeStoredMediaRoutes,
} from "../media/route-store";
import type { AndroidStatus } from "../android/types";

function androidStatus(serial = "emulator-5554"): AndroidStatus {
  return {
    platform: "android",
    serial,
    avdName: serial.startsWith("emulator-") ? "Pixel_9" : undefined,
    screen: { width: 1080, height: 2424, orientation: "portrait" },
    stream: {
      backend: serial.startsWith("emulator-") ? "emulator-controller" : "scrcpy",
      transport: serial.startsWith("emulator-") ? "mmap-videotoolbox-h264" : "scrcpy-h264",
      source: "display",
      canChangeSource: false,
    },
    camera: { front: "emulated", back: "environment", audioInput: true, canChangeLive: false },
    audio: {
      hostRoute: serial.startsWith("emulator-") ? "emulator-default" : "device-default",
      canChangeLive: false,
    },
    ...(serial.startsWith("emulator-")
      ? { emulator: { version: "36.6.4", supportsImage360: true } }
      : {}),
  };
}

describe("media routing model", () => {
  test("parses installed emulator webcam inventory", () => {
    expect(parseAndroidWebcamList(
      " Camera 'webcam0' is connected to device 'MacBook Pro Camera' on channel 0 using pixel format 'YV12'\n",
    )).toEqual([{ id: "webcam0", name: "MacBook Pro Camera" }]);
  });

  test("gates Android image360 camera mode by emulator version", () => {
    expect(parseAndroidEmulatorVersion("INFO | Android emulator version 36.6.4.0 (build_id 123)"))
      .toBe("36.6.4.0");
    expect(androidEmulatorSupportsImage360("36.6.3")).toBe(false);
    expect(androidEmulatorSupportsImage360("36.6.4")).toBe(true);
    expect(androidEmulatorSupportsImage360("37.0.0")).toBe(true);
    expect(androidEmulatorSupportsImage360(undefined)).toBe(false);
  });

  test("keeps front and back camera source validation platform-accurate", () => {
    expect(validateAndroidCameraStartupMode("front", "webcam0")).toBe(true);
    expect(validateAndroidCameraStartupMode("front", "environment")).toBe(true);
    expect(validateAndroidCameraStartupMode("back", "imagefile:/tmp/camera.png")).toBe(true);
    expect(validateAndroidCameraStartupMode("back", "videofile:/tmp/camera.mov")).toBe(true);
    expect(validateAndroidCameraStartupMode("back", "image360:/tmp/pano.jpg")).toBe(true);
    expect(validateAndroidCameraStartupMode("back", "videoplayback")).toBe(false);
  });

  test("builds Android emulator startup camera flags", () => {
    expect(androidCameraStartupArgs({
      front: "webcam0",
      back: "videofile:/tmp/camera.mov",
    })).toEqual([
      "-camera-front",
      "webcam0",
      "-camera-back",
      "videofile:/tmp/camera.mov",
    ]);
  });

  test("exposes live microphone and restart-bound webcam controls for emulators", () => {
    const state = buildDeviceMediaState(
      "android:emulator-5554",
      androidStatus(),
      [{ id: "webcam0", name: "MacBook Pro Camera" }],
      true,
    );
    expect(state.deviceKind).toBe("emulator");
    expect(state.audioInput.current).toBe("host");
    expect(state.audioInput.currentDeviceLabel).toBe("Mac default input");
    expect(state.camera.frontChoices.find((choice) => choice.id === "webcam0")).toEqual({
      id: "webcam0",
      label: "MacBook Pro Camera",
      apply: "device-restart",
      scope: "device",
    });
    expect(state.camera.supportsFiles).toBe(true);
    expect(state.camera.backChoices.find((choice) => choice.id === "image360:")?.apply)
      .toBe("device-restart");
  });

  test("marks image360 as unsupported on older emulator binaries", () => {
    const status = androidStatus();
    status.emulator = { version: "36.6.3", supportsImage360: false };
    const state = buildDeviceMediaState(
      "android:emulator-5554",
      status,
    );
    expect(state.camera.backChoices.find((choice) => choice.id === "image360:")).toEqual({
      id: "image360:",
      label: "360 image requires Emulator 36.6.4+ (current 36.6.3)",
      apply: "unsupported",
      scope: "device",
    });
  });

  test("reports physical Android media as device-owned", () => {
    const state = buildDeviceMediaState(
      "android:R5CW123",
      androidStatus("R5CW123"),
    );
    expect(state.deviceKind).toBe("physical");
    expect(state.camera.owner).toBe("device");
    expect(state.audioInput.current).toBe("device");
    expect(state.audioOutput.current).toBe("device");
  });

  test("reports iOS camera injection with Mac-wide actual and preferred audio routes", () => {
    const state = buildDeviceMediaState(
      "IOS-UDID",
      undefined,
      [],
      undefined,
      {
        input: [{ id: "mic-a", label: "Studio Mic" }],
        output: [{ id: "speaker-a", label: "Studio Speaker" }],
        defaults: { input: "mic-a", output: "speaker-a" },
      },
      [{ id: "webcam-a", label: "Continuity Camera", apply: "app-relaunch", scope: "app" }],
      { alive: false, bundleIds: [] },
      { inputDeviceId: "preferred-mic", outputDeviceId: "preferred-speaker" },
    );
    expect(state.camera.owner).toBe("agentsims-injection");
    expect(state.camera.supportsFiles).toBe(true);
    expect(state.camera.sourceChoices?.map((choice) => choice.id)).toContain("image");
    expect(state.camera.sourceChoices?.map((choice) => choice.id)).toContain("video");
    expect(state.camera.sourceChoices?.map((choice) => choice.id)).toContain("webcam-a");
    expect(state.audioInput.currentDeviceId).toBe("mic-a");
    expect(state.audioInput.preferredDeviceId).toBe("preferred-mic");
    expect(state.audioOutput.currentDeviceId).toBe("speaker-a");
    expect(state.audioOutput.preferredDeviceId).toBe("preferred-speaker");
  });

  test("persists media route preferences by device id without overwriting actual defaults", () => {
    const path = "/tmp/agentsims-media-routes-test.json";
    writeStoredMediaRoutes({ version: 1, devices: {} }, path);
    updateStoredMediaRoute("android-avd:Pixel_10", {
      inputDeviceId: "mic-a",
      outputDeviceId: "speaker-a",
      androidCameraFront: "webcam0",
      androidCameraBack: "imagefile:/tmp/back.png",
    }, path);
    expect(readStoredMediaRoutes(path).devices["android-avd:Pixel_10"]).toEqual({
      inputDeviceId: "mic-a",
      outputDeviceId: "speaker-a",
      androidCameraFront: "webcam0",
      androidCameraBack: "imagefile:/tmp/back.png",
    });
  });
});
