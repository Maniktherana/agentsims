import { describe, expect, test } from "bun:test";
import { collectAndroidAxSnapshot } from "../android/device";

describe("collectAndroidAxSnapshot", () => {
  test("derives the screen from UIAutomator bounds without extra ADB config calls", async () => {
    let screenConfigReads = 0;
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<hierarchy rotation=\"0\">",
        "<node window-id=\"42\" window-layer=\"3\" window-type=\"1\" window-active=\"true\" window-focused=\"true\" class=\"android.widget.FrameLayout\" enabled=\"true\" visible-to-user=\"true\" bounds=\"[0,0][1080,2424]\">",
        "<node text=\"Ask Vartalaap\" resource-id=\"app:id/composer\" class=\"android.widget.EditText\" enabled=\"true\" visible-to-user=\"false\" clickable=\"true\" focusable=\"true\" bounds=\"[60,2100][1020,2210]\" />",
        "</node>",
        "</hierarchy>",
      ].join(""),
      readScreenConfig: async () => {
        screenConfigReads++;
        return { width: 1, height: 1, orientation: "portrait" };
      },
    });

    expect(screenConfigReads).toBe(0);
    expect(result.screen).toEqual({ width: 1080, height: 2424 });
    expect(result.elements).toHaveLength(2);
    expect(result.elements[1]).toMatchObject({
      id: "app:id/composer",
      path: "0.0",
      label: "Ask Vartalaap",
      role: "android.widget.EditText",
      visibleToUser: false,
      traits: ["clickable", "focusable"],
      frame: { x: 60, y: 2100, width: 960, height: 110 },
    });
    expect(result.elements[0]).toMatchObject({
      visibleToUser: true,
      windowId: 42,
      windowLayer: 3,
      windowType: 1,
      windowActive: true,
      windowFocused: true,
    });
  });

  test("keeps resource IDs out of human labels", async () => {
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () =>
        "<hierarchy><node resource-id=\"app:id/root\" class=\"android.view.View\" enabled=\"true\" bounds=\"[0,0][100,100]\" /></hierarchy>",
      readScreenConfig: async () => ({
        width: 100,
        height: 100,
        orientation: "portrait",
      }),
    });

    expect(result.elements[0]).toMatchObject({
      label: "",
      nativeId: "app:id/root",
      path: "0",
    });
  });

  test("keeps screen geometry physical and clamps hidden off-screen bounds", async () => {
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => [
        "<hierarchy>",
        "<node window-id=\"10\" window-layer=\"0\" window-type=\"1\" window-active=\"true\" class=\"android.widget.FrameLayout\" enabled=\"true\" visible-to-user=\"true\" bounds=\"[0,0][1080,2424]\">",
        "<node text=\"Off-screen content\" class=\"android.view.View\" enabled=\"true\" visible-to-user=\"false\" bounds=\"[-40,2100][1120,4288]\" />",
        "</node>",
        "<node window-id=\"11\" window-layer=\"1\" window-type=\"1\" window-active=\"false\" class=\"android.widget.FrameLayout\" enabled=\"true\" visible-to-user=\"false\" bounds=\"[0,-500][1080,4288]\" />",
        "</hierarchy>",
      ].join(""),
    });

    expect(result.screen).toEqual({ width: 1080, height: 2424 });
    expect(result.elements.find((element) => element.label === "Off-screen content")?.frame)
      .toEqual({ x: 0, y: 2100, width: 1080, height: 324 });
    expect(result.elements.find((element) => element.windowId === 11)?.frame)
      .toEqual({ x: 0, y: 0, width: 1080, height: 2424 });
  });

  test("retains zero-size structural ancestors and exact native paths", async () => {
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => [
        "<hierarchy>",
        "<node window-id=\"10\" window-layer=\"0\" window-type=\"1\" window-active=\"true\" class=\"android.widget.FrameLayout\" enabled=\"true\" visible-to-user=\"true\" bounds=\"[0,0][1080,2424]\">",
        "<node class=\"android.view.ViewGroup\" enabled=\"true\" visible-to-user=\"false\" bounds=\"[0,0][0,0]\">",
        "<node text=\"Nested action\" class=\"android.widget.Button\" enabled=\"true\" visible-to-user=\"true\" clickable=\"true\" bounds=\"[40,80][240,180]\" />",
        "</node>",
        "</node>",
        "</hierarchy>",
      ].join(""),
    });

    expect(result.elements.map((element) => element.path)).toEqual([
      "0",
      "0.0",
      "0.0.0",
    ]);
    expect(result.elements[1]).toMatchObject({
      path: "0.0",
      role: "android.view.ViewGroup",
      visibleToUser: false,
      frame: { x: 0, y: 0, width: 0, height: 0 },
    });
    expect(result.elements[2]).toMatchObject({
      path: "0.0.0",
      label: "Nested action",
      visibleToUser: true,
      traits: ["clickable"],
    });
  });

  test("keeps the base app tree and stable paths while a sheet window is open", async () => {
    const baseWindow = [
      "<node resource-id=\"app:id/root\" class=\"android.widget.FrameLayout\" enabled=\"true\" bounds=\"[0,0][1080,2424]\">",
      "<node text=\"Ask Vartalaap\" class=\"android.widget.EditText\" enabled=\"true\" bounds=\"[60,2100][1020,2210]\" />",
      "</node>",
    ].join("");
    const sheetWindow = [
      "<node resource-id=\"app:id/sheet\" class=\"android.widget.FrameLayout\" enabled=\"true\" bounds=\"[0,900][1080,2424]\">",
      "<node text=\"Close sheet\" class=\"android.view.View\" enabled=\"true\" clickable=\"true\" bounds=\"[40,940][240,1040]\" />",
      "</node>",
    ].join("");
    const read = (xml: string) => collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => `<hierarchy>${xml}</hierarchy>`,
    });

    const open = await read(baseWindow + sheetWindow);
    const closed = await read(baseWindow);

    expect(open.elements.map((element) => element.label)).toContain("Ask Vartalaap");
    expect(open.elements.map((element) => element.label)).toContain("Close sheet");
    expect(open.elements.find((element) => element.label === "Ask Vartalaap")?.path)
      .toBe("0.0");
    expect(closed.elements.find((element) => element.label === "Ask Vartalaap")?.path)
      .toBe("0.0");
    expect(open.elements.find((element) => element.label === "Close sheet")?.path)
      .toBe("1.0");
  });

  test("reads screen config only as a fallback when UIAutomator fails", async () => {
    let screenConfigReads = 0;
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => {
        throw new Error("UIAutomator timed out");
      },
      readScreenConfig: async () => {
        screenConfigReads++;
        return { width: 1080, height: 2424, orientation: "portrait" };
      },
    });

    expect(screenConfigReads).toBe(1);
    expect(result.screen).toEqual({ width: 1080, height: 2424 });
    expect(result.elements).toEqual([]);
    expect(result.errors).toEqual(["UIAutomator timed out"]);
  });

  test("uses the hot fresh path by default for browser captures", async () => {
    const modes: string[] = [];
    await collectAndroidAxSnapshot("emulator-5554", {
      readFastXml: async (_serial, mode) => {
        modes.push(mode);
        return "<hierarchy><node class=\"android.view.View\" enabled=\"true\" bounds=\"[0,0][100,100]\" /></hierarchy>";
      },
      readFallbackXml: async () => {
        throw new Error("fallback should not run");
      },
    });

    expect(modes).toEqual(["fresh"]);
  });

  test("forwards settled mode to the persistent provider", async () => {
    const modes: string[] = [];
    await collectAndroidAxSnapshot("emulator-5554", {
      mode: "settled",
      readFastXml: async (_serial, mode) => {
        modes.push(mode);
        return "<hierarchy><node class=\"android.view.View\" enabled=\"true\" bounds=\"[0,0][100,100]\" /></hierarchy>";
      },
    });
    expect(modes).toEqual(["settled"]);
  });

  test("falls back once to stock UIAutomator without weakening the requested mode", async () => {
    const calls: string[] = [];
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      mode: "settled",
      readFastXml: async (_serial, mode) => {
        calls.push(`fast:${mode}`);
        throw new Error("hidden API unavailable");
      },
      readFallbackXml: async () => {
        calls.push("fallback");
        return "<hierarchy><node class=\"android.view.View\" enabled=\"true\" bounds=\"[0,0][100,100]\" /></hierarchy>";
      },
    });

    expect(calls).toEqual(["fast:settled", "fallback"]);
    expect(result.errors).toEqual([
      "Fast Android AX unavailable; using stock UIAutomator: hidden API unavailable",
    ]);
    expect(result.elements).toHaveLength(1);
  });
});
