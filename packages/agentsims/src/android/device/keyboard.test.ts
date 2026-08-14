import { describe, expect, test } from "bun:test";
import {
  androidKeycodeForHidUsage,
  androidNightModeEnabled,
  parseAndroidForegroundPackage,
} from "./device";

describe("Android browser keyboard mapping", () => {
  test("maps letters, digits, editing, navigation, and modifiers", () => {
    expect(androidKeycodeForHidUsage(0x04)).toBe(29); // A
    expect(androidKeycodeForHidUsage(0x1d)).toBe(54); // Z
    expect(androidKeycodeForHidUsage(0x1e)).toBe(8); // 1
    expect(androidKeycodeForHidUsage(0x27)).toBe(7); // 0
    expect(androidKeycodeForHidUsage(0x28)).toBe(66); // Enter
    expect(androidKeycodeForHidUsage(0x2a)).toBe(67); // Backspace
    expect(androidKeycodeForHidUsage(0x50)).toBe(21); // Left
    expect(androidKeycodeForHidUsage(0xe1)).toBe(59); // Left shift
  });

  test("maps function and numpad ranges and rejects unknown usages", () => {
    expect(androidKeycodeForHidUsage(0x3a)).toBe(131); // F1
    expect(androidKeycodeForHidUsage(0x45)).toBe(142); // F12
    expect(androidKeycodeForHidUsage(0x59)).toBe(145); // Numpad 1
    expect(androidKeycodeForHidUsage(0x61)).toBe(153); // Numpad 9
    expect(androidKeycodeForHidUsage(0x47)).toBeNull();
    expect(androidKeycodeForHidUsage(Number.NaN)).toBeNull();
  });
});

describe("Android app and appearance parsing", () => {
  test("reads the resumed package from modern activity output", () => {
    expect(parseAndroidForegroundPackage(
      "topResumedActivity=ActivityRecord{67737664 u0 ai.puch/.MainActivity t85}",
    )).toBe("ai.puch");
    expect(parseAndroidForegroundPackage("mResumedActivity: ActivityRecord{1 u0 com.example/.Main t2}"))
      .toBe("com.example");
    expect(parseAndroidForegroundPackage("no resumed app")).toBeNull();
  });

  test("reads Android night mode output", () => {
    expect(androidNightModeEnabled("Night mode: yes")).toBe(true);
    expect(androidNightModeEnabled("Night mode: no")).toBe(false);
    expect(androidNightModeEnabled("Night mode: 2")).toBe(true);
  });
});
