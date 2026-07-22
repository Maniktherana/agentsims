import { describe, expect, test } from "bun:test";
import { parseAndroidWebcamList, validateAndroidCameraSource } from "../android/device";
import { buildDeviceMediaState } from "../media/router";
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
    camera: { front: "emulated", back: "virtualscene", canChangeLive: false },
    audio: {
      hostRoute: serial.startsWith("emulator-") ? "emulator-default" : "device-default",
      canChangeLive: false,
    },
  };
}

describe("media routing model", () => {
  test("parses installed emulator webcam inventory", () => {
    expect(parseAndroidWebcamList(
      " Camera 'webcam0' is connected to device 'MacBook Pro Camera' on channel 0 using pixel format 'YV12'\n",
    )).toEqual([{ id: "webcam0", name: "MacBook Pro Camera" }]);
  });

  test("keeps front and back camera source validation platform-accurate", () => {
    expect(validateAndroidCameraSource("front", "webcam0")).toBe(true);
    expect(validateAndroidCameraSource("front", "virtualscene")).toBe(false);
    expect(validateAndroidCameraSource("back", "virtualscene")).toBe(true);
    expect(validateAndroidCameraSource("back", "videoplayback")).toBe(true);
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
    expect(state.audioInput.choices.find((choice) => choice.id === "host")?.apply).toBe("live");
    expect(state.camera.frontChoices.find((choice) => choice.id === "webcam0")).toEqual({
      id: "webcam0",
      label: "MacBook Pro Camera",
      apply: "device-restart",
    });
    expect(state.camera.supportsLivePoster).toBe(true);
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

  test("reports iOS camera injection separately from immutable host audio defaults", () => {
    const state = buildDeviceMediaState("IOS-UDID");
    expect(state.camera.owner).toBe("agentsims-injection");
    expect(state.camera.supportsFiles).toBe(true);
    expect(state.audioInput.choices[0]?.apply).toBe("unsupported");
    expect(state.audioOutput.choices[0]?.apply).toBe("unsupported");
  });
});
