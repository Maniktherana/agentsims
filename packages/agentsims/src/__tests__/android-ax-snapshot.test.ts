import { describe, expect, test } from "bun:test";
import { collectAndroidAxSnapshot } from "../android/device";

describe("collectAndroidAxSnapshot", () => {
  test("derives the screen from UIAutomator bounds without extra ADB config calls", async () => {
    let screenConfigReads = 0;
    const result = await collectAndroidAxSnapshot("emulator-5554", {
      readXml: async () => [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<hierarchy rotation=\"0\">",
        "<node class=\"android.widget.FrameLayout\" enabled=\"true\" bounds=\"[0,0][1080,2424]\" />",
        "<node text=\"Ask Vartalaap\" resource-id=\"app:id/composer\" class=\"android.widget.EditText\" enabled=\"true\" bounds=\"[60,2100][1020,2210]\" />",
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
      label: "Ask Vartalaap",
      role: "android.widget.EditText",
      frame: { x: 60, y: 2100, width: 960, height: 110 },
    });
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
});
