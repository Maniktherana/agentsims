import { describe, expect, test } from "bun:test";
import {
  androidScreenConfigFromOutputs,
  androidCornerRadiiForRotation,
  androidEmulatorNativeRotationCommands,
  androidEmulatorAbsoluteRotationCommands,
  androidPowerNeedsWake,
  androidEmulatorRotationUnlockCommand,
  androidEmulatorViewportCommand,
  logicalSizeForRotation,
  parseAndroidRoundedCorners,
  parseAndroidEmulatorViewportState,
} from "../android/device";
import {
  androidOrientationForScreen,
  androidRotationForOrientation,
  androidTouchCoordinatesForTransport,
  clockwiseAndroidRotationSteps,
} from "../android/session";
import { pointForRelayTransport } from "../web/simulator/orientation";

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
    // `adb emu rotate` turns the virtual device clockwise, which makes
    // Android's display-rotation enum move backwards (r0 -> r3 -> r2 -> r1).
    expect(clockwiseAndroidRotationSteps(0, 1)).toBe(3);
    expect(clockwiseAndroidRotationSteps(2, 3)).toBe(3);
    expect(clockwiseAndroidRotationSteps(3, 0)).toBe(3);
    expect(clockwiseAndroidRotationSteps(0, 3)).toBe(1);
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

  test("scopes an absolute emulator rotation and restores normal autorotate", () => {
    expect(androidEmulatorAbsoluteRotationCommands("emulator-5554", 1, 2)).toEqual({
      prepare: [
        ["-s", "emulator-5554", "shell", "wm", "set-ignore-orientation-request", "true"],
        ["-s", "emulator-5554", "shell", "cmd", "window", "user-rotation", "lock", "1"],
        ["-s", "emulator-5554", "shell", "cmd", "window", "fixed-to-user-rotation", "enabled"],
        ["-s", "emulator-5554", "emu", "sensor", "set", "acceleration", "0:-9.81:0"],
        ["-s", "emulator-5554", "shell", "cmd", "window", "user-rotation", "lock", "2"],
      ],
      cleanup: [
        ["-s", "emulator-5554", "shell", "cmd", "window", "user-rotation", "free"],
        ["-s", "emulator-5554", "shell", "cmd", "window", "fixed-to-user-rotation", "default"],
        ["-s", "emulator-5554", "shell", "wm", "set-ignore-orientation-request", "reset"],
      ],
    });
  });

  test("wakes only a non-interactive emulator before rotating", () => {
    expect(androidPowerNeedsWake("mWakefulness=Awake\nmIsInteractive=true")).toBe(false);
    expect(androidPowerNeedsWake("mWakefulness=Asleep\nmIsInteractive=false")).toBe(true);
    expect(androidPowerNeedsWake("mWakefulness=Dozing")).toBe(true);
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

  test("keeps every internal viewport line so a phone placeholder cannot hide the active one", () => {
    expect(androidEmulatorViewportCommand("emulator-5554")).toEqual([
      "-s",
      "emulator-5554",
      "shell",
      "dumpsys input | grep 'Viewport INTERNAL:'",
    ]);
  });

  test("reads explicit Android display corner radii and distinguishes zero from unknown", () => {
    const phone = `
      DisplayDeviceInfo{"Wireless": 1920 x 1080, roundedCorners RoundedCorners{[RoundedCorner{position=TopLeft, radius=999, center=Point(999, 999)}]}, type EXTERNAL}
      DisplayDeviceInfo{"Built-in Screen": 1080 x 2424, roundedCorners RoundedCorners{[RoundedCorner{position=TopLeft, radius=132, center=Point(132, 132)}, RoundedCorner{position=TopRight, radius=120, center=Point(960, 120)}, RoundedCorner{position=BottomRight, radius=96, center=Point(984, 2328)}, RoundedCorner{position=BottomLeft, radius=72, center=Point(72, 2352)}]}, touch INTERNAL, rotation 0}
    `;
    const tablet = `
      DisplayDeviceInfo{"Built-in Screen": 2560 x 1600, roundedCorners RoundedCorners{[RoundedCorner{position=TopLeft, radius=0, center=Point(0, 0)}, RoundedCorner{position=TopRight, radius=0, center=Point(2560, 0)}, RoundedCorner{position=BottomRight, radius=0, center=Point(2560, 1600)}, RoundedCorner{position=BottomLeft, radius=0, center=Point(0, 1600)}]}, touch INTERNAL, rotation 3}
    `;

    expect(parseAndroidRoundedCorners(phone)).toEqual({
      topLeft: 132,
      topRight: 120,
      bottomRight: 96,
      bottomLeft: 72,
    });
    expect(parseAndroidRoundedCorners(tablet)).toEqual({
      topLeft: 0,
      topRight: 0,
      bottomRight: 0,
      bottomLeft: 0,
    });
    expect(parseAndroidRoundedCorners("Display: mDisplayId=0")).toBeUndefined();
  });

  test("maps asymmetric physical corners through every Android rotation", () => {
    const native = { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 };
    expect(androidCornerRadiiForRotation(native, 0)).toEqual(native);
    expect(androidCornerRadiiForRotation(native, 1)).toEqual({
      topLeft: 2,
      topRight: 3,
      bottomRight: 4,
      bottomLeft: 1,
    });
    expect(androidCornerRadiiForRotation(native, 2)).toEqual({
      topLeft: 3,
      topRight: 4,
      bottomRight: 1,
      bottomLeft: 2,
    });
    expect(androidCornerRadiiForRotation(native, 3)).toEqual({
      topLeft: 4,
      topRight: 1,
      bottomRight: 2,
      bottomLeft: 3,
    });
  });

  test("keeps viewport rotation and physical corner mapping joined in canonical configs", () => {
    const expected = [
      { topLeft: 1, topRight: 2, bottomRight: 3, bottomLeft: 4 },
      { topLeft: 2, topRight: 3, bottomRight: 4, bottomLeft: 1 },
      { topLeft: 3, topRight: 4, bottomRight: 1, bottomLeft: 2 },
      { topLeft: 4, topRight: 1, bottomRight: 2, bottomLeft: 3 },
    ];
    for (const rotation of [0, 1, 2, 3] as const) {
      const logical = logicalSizeForRotation({ width: 1080, height: 2424 }, rotation);
      const display = `
        DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, orientation=${rotation}, logicalFrame=Rect(0, 0 - ${logical.width}, ${logical.height})}
        DisplayDeviceInfo{"Built-in Screen": 1080 x 2424, roundedCorners RoundedCorners{[RoundedCorner{position=TopLeft, radius=1, center=Point(1, 1)}, RoundedCorner{position=TopRight, radius=2, center=Point(1078, 2)}, RoundedCorner{position=BottomRight, radius=3, center=Point(1077, 2421)}, RoundedCorner{position=BottomLeft, radius=4, center=Point(4, 2420)}]}, touch INTERNAL, rotation ${rotation}}
      `;
      const config = androidScreenConfigFromOutputs(
        "Physical size: 1080x2424",
        "Physical density: 420",
        display,
        "free",
        "1",
      );
      expect(config).toMatchObject({
        ...logical,
        rotation,
        cornerRadii: expected[rotation],
      });
    }
  });

  test("adds logical corner geometry to canonical screen config", () => {
    const display = `
      DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, orientation=3, logicalFrame=Rect(0, 0 - 1600, 2560)}
      DisplayDeviceInfo{"Built-in Screen": 2560 x 1600, roundedCorners RoundedCorners{[RoundedCorner{position=TopLeft, radius=20, center=Point(20, 20)}, RoundedCorner{position=TopRight, radius=30, center=Point(2530, 30)}, RoundedCorner{position=BottomRight, radius=40, center=Point(2520, 1560)}, RoundedCorner{position=BottomLeft, radius=50, center=Point(50, 1550)}]}, touch INTERNAL, rotation 3}
    `;
    const config = androidScreenConfigFromOutputs(
      "Physical size: 2560x1600",
      "Physical density: 320",
      display,
      "free",
      "3",
    );

    expect(config?.cornerRadii).toEqual({
      topLeft: 50,
      topRight: 20,
      bottomRight: 30,
      bottomLeft: 40,
    });
  });

  test("keeps an explicit zero-radius default display when device info omits corners", () => {
    const display = `
      DisplayViewport{type=INTERNAL, valid=true, isActive=true, displayId=0, orientation=3, logicalFrame=Rect(0, 0 - 1600, 2560)}
      DisplayDeviceInfo{"Built-in Screen": 2560 x 1600, touch INTERNAL, rotation 0, type INTERNAL}
    `;
    const windowDisplays = `
      Display: mDisplayId=2 (organized)
        mRoundedCorners=RoundedCorners{[RoundedCorner{position=TopLeft, radius=999, center=Point(999, 999)}]}
      Display: mDisplayId=0 (organized)
        mRoundedCorners=RoundedCorners{[RoundedCorner{position=TopLeft, radius=0, center=Point(0, 0)}, RoundedCorner{position=TopRight, radius=0, center=Point(1600, 0)}, RoundedCorner{position=BottomRight, radius=0, center=Point(1600, 2560)}, RoundedCorner{position=BottomLeft, radius=0, center=Point(0, 2560)}]}
    `;
    const config = androidScreenConfigFromOutputs(
      "Physical size: 2560x1600",
      "Physical density: 320",
      display,
      "free",
      "1",
      windowDisplays,
    );

    expect(config).toMatchObject({
      width: 1600,
      height: 2560,
      rotation: 3,
      cornerRadii: { topLeft: 0, topRight: 0, bottomRight: 0, bottomLeft: 0 },
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
          { x: 0.25, y: 0.75 },
          { ...logical, rotation },
        ),
      ).toEqual(expectedByRotation[rotation]);
    }
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
          { x: 0.25, y: 0.75 },
          { ...logical, rotation },
        ),
      ).toEqual(expectedByRotation[rotation]);
    }
  });

  test("maps display input exactly once across the browser relay and Android session", () => {
    for (const native of [
      { width: 1080, height: 2424 },
      { width: 2560, height: 1600 },
    ]) {
      for (const rotation of [0, 1, 2, 3] as const) {
        const logical = logicalSizeForRotation(native, rotation);
        const displayPoint = { x: 0.25, y: 0.75 };
        const relayed = pointForRelayTransport(
          {
            ...logical,
            orientation: androidOrientationForScreen({ ...logical, rotation }),
          },
          "display",
          displayPoint.x,
          displayPoint.y,
        );
        expect(relayed).toEqual(displayPoint);
        expect(
          androidTouchCoordinatesForTransport(
            relayed,
            { ...logical, rotation },
          ),
        ).toEqual(
          androidTouchCoordinatesForTransport(
            displayPoint,
            { ...logical, rotation },
          ),
        );
      }
    }
  });

  test("turns a displayed vertical gesture into the matching physical direction", () => {
    const logical = { width: 2560, height: 1600, rotation: 2 } as const;
    const begin = androidTouchCoordinatesForTransport(
      { x: 0.4, y: 0.25 },
      logical,
    );
    const end = androidTouchCoordinatesForTransport(
      { x: 0.4, y: 0.75 },
      logical,
    );

    expect(begin.x).toBe(end.x);
    expect(begin.y).toBeGreaterThan(end.y);
  });
});
