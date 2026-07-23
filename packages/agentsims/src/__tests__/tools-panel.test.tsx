import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AndroidStatus } from "../android/types";
import {
  AndroidControlsStatus,
  formatAndroidDisplay,
  formatAndroidStream,
} from "../web/components/android-controls-tool";
import { MediaRoutingSection } from "../web/components/media-routing-tool";
import { ToolsPanel } from "../web/components/tools-panel";

const noop = () => {};

describe("ToolsPanel", () => {
  test("uses the shared panel background variable", () => {
    const html = renderToStaticMarkup(
      <ToolsPanel
        open={false}
        onClose={noop}
        udid="one"
        deviceRuntime="iOS-27-0"
        currentApp={null}
        codecPreference="auto"
        onCodecPreferenceChange={noop}
        activeCodec="h264"
        avccSupported
        width={320}
      />,
    );

    expect(html).toContain("background-color:var(--agentsims-panel-bg)");
    expect(html).not.toContain("Annotate");
  });

  test("reserves Android device metadata geometry while status loads", () => {
    const html = renderToStaticMarkup(
      <AndroidControlsStatus
        udid="android:emulator-5554"
        status={null}
        loading
        error={null}
        onRefresh={noop}
      />,
    );

    expect(html).toContain(">Android<");
    expect(html).toContain('data-android-device-subtitle="true"');
    expect(html).toContain(">Loading<");
    expect(html).toContain("Display");
    expect(html).toContain("Stream");
    expect(html).toContain('data-android-metadata="true"');
    expect(html).toContain("Device ID");
    expect(html).not.toContain("border-t border-white");
    expect(html).not.toContain("border-b border-white");
    expect(html).not.toContain(">Camera<");
    expect(html).not.toContain(">Audio<");
  });

  test("formats Android transport details for developers without raw backend names", () => {
    const status: AndroidStatus = {
      platform: "android",
      serial: "emulator-5554",
      release: "17",
      screen: {
        width: 1080,
        height: 2424,
        density: 420,
        orientation: "portrait",
      },
      stream: {
        backend: "emulator-controller",
        transport: "mmap-videotoolbox-h264",
        source: "display",
        canChangeSource: false,
      },
      camera: { canChangeLive: false },
      audio: {
        hostRoute: "emulator-default",
        canChangeLive: false,
      },
    };

    expect(formatAndroidDisplay(status)).toBe("1080 × 2424 @ 420 dpi");
    expect(formatAndroidStream(status)).toBe("H.264 · emulator framebuffer");
    expect(formatAndroidStream({
      ...status,
      stream: {
        ...status.stream,
        backend: "scrcpy",
        transport: "scrcpy-h264",
      },
    })).toBe("H.264 · scrcpy");
  });

  test("opens real Android emulator media capabilities with a stable loading footprint", () => {
    const html = renderToStaticMarkup(
      <MediaRoutingSection
        udid="android:emulator-5554"
        open
        onOpenChange={noop}
        state={null}
        loading
        pending={null}
        restartRequired={false}
        error={null}
        onApply={noop}
      />,
    );

    expect(html).toContain("<details open");
    expect(html).toContain("Camera &amp; audio");
    expect(html).toContain("Front camera");
    expect(html).toContain("Back camera");
    expect(html).toContain("Microphone");
    expect(html).toContain("Output");
    expect(html).toContain('data-media-group="camera"');
    expect(html).toContain('data-media-group="audio"');
    expect(html).not.toContain("border-t border-white");
    expect(html).toContain("animate-pulse");
  });

  test("does not expose emulator camera selectors for physical Android devices", () => {
    const html = renderToStaticMarkup(
      <MediaRoutingSection
        udid="android:R5CW123"
        open={false}
        onOpenChange={noop}
        state={null}
        loading
        pending={null}
        restartRequired={false}
        error={null}
        onApply={noop}
      />,
    );

    expect(html).not.toContain("Front camera");
    expect(html).not.toContain("Back camera");
    expect(html).toContain("Microphone");
    expect(html).toContain("Output");
  });
});
