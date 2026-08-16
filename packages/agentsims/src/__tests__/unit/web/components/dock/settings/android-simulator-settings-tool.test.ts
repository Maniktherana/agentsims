import { describe, expect, test } from "bun:test";
import {
  nearestAndroidFontScaleIndex,
  parseAndroidSimulatorSettings,
} from "../../../../../../web/components/dock/settings/android-simulator-settings-tool";

describe("Android simulator settings", () => {
  test("parses adb output into the shared simulator control model", () => {
    expect(parseAndroidSimulatorSettings({
      nightMode: "Night mode: yes",
      fontScale: "1.18",
      animationScale: "0.0",
      showTouches: "1",
      pointerLocation: "0",
    })).toEqual({
      appearance: "dark",
      textSizeIndex: 4,
      reduceMotion: true,
      showTouches: true,
      pointerLocation: false,
    });
  });

  test("uses Android defaults for unset settings", () => {
    expect(parseAndroidSimulatorSettings({
      nightMode: "Night mode: no",
      fontScale: "null",
      animationScale: "null",
      showTouches: "null",
      pointerLocation: "null",
    })).toEqual({
      appearance: "light",
      textSizeIndex: 2,
      reduceMotion: false,
      showTouches: false,
      pointerLocation: false,
    });
  });

  test("snaps arbitrary font scales to the nearest slider stop", () => {
    expect(nearestAndroidFontScaleIndex("1.29")).toBe(5);
    expect(nearestAndroidFontScaleIndex("0.86")).toBe(0);
  });
});
