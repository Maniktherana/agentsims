import { describe, expect, test } from "bun:test";
import {
  androidScreenConfigFromOutputs,
  androidEmulatorNativeRotationCommands,
  androidEmulatorRotationUnlockCommand,
  logicalSizeForRotation,
  parseAndroidEmulatorViewportState,
} from "../android/device";
import {
  androidOrientationForScreen,
  androidRotationForOrientation,
  androidTouchCoordinatesForTransport,
  clockwiseAndroidRotationSteps,
} from "../android/session";

describe("Android rotated emulator input", () => {
  test("derives logical dimensions from the device's native aspect", () => {
    const phone = { width: 1080, height: 2424 };
    const tablet = { width: 2560, height: 1600 };

    expect(logicalSizeForRotation(phone, 0)).toEqual(phone);
    expect(logicalSizeForRotation(phone, 1)).toEqual({ width: 2424, height: 1080 });
    expect(logicalSizeForRotation(phone, 2)).toEqual(phone);
    expect(logicalSizeForRotation(phone, 3)).toEqual({ width: 2424, height: 1080 });

    expect(logicalSizeForRotation(tablet, 0)).toEqual(tablet);
    expect(logicalSizeForRotation(tablet, 1)).toEqual({ width: 1600, height: 2560 });
    expect(logicalSizeForRotation(tablet, 2)).toEqual(tablet);
    expect(logicalSizeForRotation(tablet, 3)).toEqual({ width: 1600, height: 2560 });
  });

  test("keeps the toolbar orientation cycle correct for landscape-native tablets", () => {
    const expected = [
      "landscape_left",
      "portrait_upside_down",
      "landscape_right",
      "portrait",
    ] as const;

    for (const rotation of [0, 1, 2, 3] as const) {
      const logical = logicalSizeForRotation({ width: 2560, height: 1600 }, rotation);
      expect(androidOrientationForScreen({ ...logical, rotation })).toBe(expected[rotation]);
      expect(
        androidRotationForOrientation(expected[(rotation + 1) % 4]!, {
          ...logical,
          rotation,
        }),
      ).toBe((rotation + 1) % 4);
    }
  });

  test("keeps the standard orientation cycle for portrait-native phones", () => {
    const expected = [
      "portrait",
      "landscape_left",
      "portrait_upside_down",
      "landscape_right",
    ] as const;

    for (const rotation of [0, 1, 2, 3] as const) {
      const logical = logicalSizeForRotation({ width: 1080, height: 2424 }, rotation);
      expect(androidOrientationForScreen({ ...logical, rotation })).toBe(expected[rotation]);
      expect(
        androidRotationForOrientation(expected[rotation], { ...logical, rotation }),
      ).toBe(rotation);
    }
  });

  test("computes native emulator clockwise rotation steps without guessing geometry", () => {
    expect(clockwiseAndroidRotationSteps(0, 0)).toBe(0);
    expect(clockwiseAndroidRotationSteps(0, 1)).toBe(1);
    expect(clockwiseAndroidRotationSteps(2, 3)).toBe(1);
    expect(clockwiseAndroidRotationSteps(3, 0)).toBe(1);
    expect(clockwiseAndroidRotationSteps(0, 3)).toBe(3);
  });

  test("clears a stale devtool rotation lock before native emulator rotation", () => {
    expect(androidEmulatorRotationUnlockCommand("emulator-5556")).toEqual([
      "-s",
      "emulator-5556",
      "shell",
      "cmd",
      "window",
      "user-rotation",
      "free",
    ]);
    expect(androidEmulatorNativeRotationCommands("emulator-5556", 0)).toEqual([]);
    expect(androidEmulatorNativeRotationCommands("emulator-5556", 1)).toEqual([
      ["-s", "emulator-5556", "emu", "rotate"],
    ]);
    expect(androidEmulatorNativeRotationCommands("emulator-5556", 3)).toEqual([
      ["-s", "emulator-5556", "emu", "rotate"],
      ["-s", "emulator-5556", "emu", "rotate"],
      ["-s", "emulator-5556", "emu", "rotate"],
    ]);
  });

  test("uses the active internal viewport instead of a decoy rotation record", () => {
    const display = `
      mViewports=[DisplayViewport{type=EXTERNAL, valid=true, isActive=true, displayId=2, orientation=0, logicalFrame=Rect(0, 0 - 1920, 1080), physicalFrame=Rect(0, 0 - 1920, 1080)}, DisplayViewport{type=INTERNAL, valid=true, isActive=false, displayId=0, orientation=0, logicalFrame=Rect(0, 0 - 2560, 1600), physicalFrame=Rect(0, 0 - 2560, 1600)}, DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, orientation=3, logicalFrame=Rect(0, 0 - 1600, 2560), physicalFrame=Rect(0, 0 - 1600, 2560)}]
      DisplayDeviceInfo{"Built-in Screen", 2560 x 1600, rotation 0, type INTERNAL}
      mCurrentOrientation=0
    `;
    const config = androidScreenConfigFromOutputs(
      "Physical size: 2560x1600",
      "Physical density: 320",
      display,
      "free",
      "2",
    );

    expect(config).toEqual({
      width: 1600,
      height: 2560,
      orientation: "portrait",
      density: 320,
      rotation: 3,
    });
    expect(
      androidTouchCoordinatesForTransport(
        "emulator-controller",
        { x: 0.25, y: 0.75 },
        config!,
      ),
    ).toEqual({ x: 1920, y: 1200, width: 2560, height: 1600 });
  });

  test("reads only the active internal input viewport for the live watcher", () => {
    const output = [
      "Viewport EXTERNAL: displayId=2, orientation=0, logicalFrame=[0, 0, 1920, 1080], isActive=[1]",
      "Viewport INTERNAL: displayId=0, orientation=3, logicalFrame=[0, 0, 1600, 2560], isActive=[0]",
      "Viewport INTERNAL: displayId=0, orientation=2, logicalFrame=[0, 0, 2560, 1600], isActive=[1]",
    ].join("\n");
    expect(parseAndroidEmulatorViewportState(output)).toEqual({
      width: 2560,
      height: 1600,
      rotation: 2,
    });
  });

  test("maps display coordinates into the emulator's physical touch axes", () => {
    const expectedByRotation = [
      { x: 640, y: 1200, width: 2560, height: 1600 },
      { x: 640, y: 400, width: 2560, height: 1600 },
      { x: 1920, y: 400, width: 2560, height: 1600 },
      { x: 1920, y: 1200, width: 2560, height: 1600 },
    ];

    for (const rotation of [0, 1, 2, 3] as const) {
      const logical = logicalSizeForRotation({ width: 2560, height: 1600 }, rotation);
      expect(
        androidTouchCoordinatesForTransport(
          "emulator-controller",
          { x: 0.25, y: 0.75 },
          { ...logical, rotation },
        ),
      ).toEqual(expectedByRotation[rotation]);
    }
  });

  test("leaves scrcpy in logical display coordinates", () => {
    expect(
      androidTouchCoordinatesForTransport(
        "scrcpy",
        { x: 0.25, y: 0.75 },
        { width: 1600, height: 2560, rotation: 1 },
      ),
    ).toEqual({ x: 400, y: 1920, width: 1600, height: 2560 });
  });

  test("maps portrait-native phones through the same physical-axis table", () => {
    const expectedByRotation = [
      { x: 270, y: 1818, width: 1080, height: 2424 },
      { x: 270, y: 606, width: 1080, height: 2424 },
      { x: 810, y: 606, width: 1080, height: 2424 },
      { x: 810, y: 1818, width: 1080, height: 2424 },
    ];

    for (const rotation of [0, 1, 2, 3] as const) {
      const logical = logicalSizeForRotation({ width: 1080, height: 2424 }, rotation);
      expect(
        androidTouchCoordinatesForTransport(
          "emulator-controller",
          { x: 0.25, y: 0.75 },
          { ...logical, rotation },
        ),
      ).toEqual(expectedByRotation[rotation]);
    }
  });

  test("turns a displayed vertical gesture into the matching physical direction", () => {
    const logical = { width: 2560, height: 1600, rotation: 2 } as const;
    const begin = androidTouchCoordinatesForTransport(
      "emulator-controller",
      { x: 0.4, y: 0.25 },
      logical,
    );
    const end = androidTouchCoordinatesForTransport(
      "emulator-controller",
      { x: 0.4, y: 0.75 },
      logical,
    );

    expect(begin.x).toBe(end.x);
    expect(begin.y).toBeGreaterThan(end.y);
  });
});
