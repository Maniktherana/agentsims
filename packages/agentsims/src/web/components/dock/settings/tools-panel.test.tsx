import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { AndroidStatus } from "../../../../android/device/types";
import type { DeviceMediaState } from "../../../../server/media/model";
import {
  AndroidControlsStatus,
  formatAndroidDisplay,
  formatAndroidStream,
} from "./android-controls-tool";
import { MediaRoutingSection } from "./media-routing-tool";
import { ToolsPanel } from "./tools-panel";

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
  });

  test("matches iOS section order and opens only Simulator for Android", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { location: { pathname: "/" } },
    });
    let html: string;
    try {
      html = renderToStaticMarkup(
        <ToolsPanel
          open
          onClose={noop}
          udid="android:emulator-5554"
          deviceRuntime="Android-17"
          currentApp={null}
          codecPreference="auto"
          onCodecPreferenceChange={noop}
          activeCodec="h264"
          avccSupported
          width={320}
        />,
      );
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
      else Reflect.deleteProperty(globalThis, "window");
    }

    const simulator = html.indexOf(">Simulator<");
    const camera = html.indexOf(">Camera<");
    const audio = html.indexOf(">Audio<");
    const location = html.indexOf(">Location<");
    const stream = html.indexOf(">Stream<");

    expect(simulator).toBeGreaterThan(-1);
    expect(camera).toBeGreaterThan(simulator);
    expect(audio).toBeGreaterThan(camera);
    expect(location).toBeGreaterThan(audio);
    expect(stream).toBeGreaterThan(location);
    expect(html.match(/<details open/g)?.length ?? 0).toBe(1);
  });

  test("renders Android device metadata without creating its own accordion", () => {
    const html = renderToStaticMarkup(
      <AndroidControlsStatus
        udid="android:emulator-5554"
        status={null}
        loading
        error={null}
        onRefresh={noop}
      />,
    );

    expect(html).toContain('data-android-device-subtitle="true"');
    expect(html).toContain(">Loading<");
    expect(html).toContain("Display");
    expect(html).toContain("Stream");
    expect(html).toContain('data-android-metadata="true"');
    expect(html).toContain("Device ID");
    expect(html).not.toContain("<details");
    expect(html).not.toContain(">Android<");
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
        transport: "mmap-ffmpeg-h264",
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
    expect(
      formatAndroidStream({
        ...status,
        stream: {
          ...status.stream,
          backend: "unsupported",
          transport: "none",
        },
      }),
    ).toBe("Live stream unavailable");
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
    expect(html).toContain(">Camera<");
    expect(html).toContain(">Audio<");
    expect(html).toContain('role="tablist"');
    expect(html).toContain(">Front<");
    expect(html).toContain(">Back<");
    expect(html).toContain("Startup route");
    expect(html).toContain("Media file");
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

    expect(html).not.toContain(">Camera<");
    expect(html).not.toContain("Startup route");
    expect(html).toContain("Microphone");
    expect(html).toContain("Output");
  });

  test("renders Android audio as a device-reported discrete slider", () => {
    const mediaState: DeviceMediaState = {
      platform: "android",
      deviceKind: "emulator",
      deviceId: "android:emulator-5554",
      camera: {
        owner: "android-emulator",
        frontChoices: [],
        backChoices: [],
        supportsFiles: true,
        supportsLivePoster: false,
      },
      audioInput: {
        current: "host",
        currentDeviceId: "mic-a",
        currentDeviceLabel: "Studio Mic",
        choices: [{ id: "mic-a", label: "Studio Mic", apply: "live", scope: "host-global" }],
        scope: "host-global",
      },
      audioOutput: {
        current: "host-system-default",
        currentDeviceId: "speaker-a",
        currentDeviceLabel: "Studio Speaker",
        choices: [
          {
            id: "speaker-a",
            label: "Studio Speaker",
            apply: "live",
            scope: "host-global",
          },
        ],
        scope: "host-global",
        volume: 1,
        volumeSettable: true,
        volumeLevel: { current: 15, min: 0, max: 15 },
      },
    };
    const html = renderToStaticMarkup(
      <MediaRoutingSection
        udid="android:emulator-5554"
        open
        onOpenChange={noop}
        state={mediaState}
        loading={false}
        pending={null}
        restartRequired={false}
        error={null}
        onApply={noop}
      />,
    );

    expect(html).toContain("Test microphone");
    expect(html).toContain('aria-label="Microphone input level"');
    expect(html).toContain('aria-label="Simulator volume"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="15"');
    expect(html).toContain('step="1"');
    expect(html).toContain("15 / 15");
    expect(html).not.toContain('aria-label="Output volume"');
    expect(html).not.toContain("Mac-wide");
  });

  test("does not expose host output volume as a simulator control", () => {
    const mediaState: DeviceMediaState = {
      platform: "android",
      deviceKind: "emulator",
      deviceId: "android:emulator-5554",
      camera: {
        owner: "android-emulator",
        frontChoices: [],
        backChoices: [],
        supportsFiles: true,
        supportsLivePoster: false,
      },
      audioInput: {
        current: "system-default",
        currentDeviceId: "mic-a",
        currentDeviceLabel: "Studio Mic",
        choices: [],
        scope: "host-global",
      },
      audioOutput: {
        current: "host-system-default",
        currentDeviceId: "speaker-a",
        currentDeviceLabel: "Studio Speaker",
        choices: [],
        scope: "host-global",
        volume: 0.64,
        volumeSettable: true,
      },
    };
    const html = renderToStaticMarkup(
      <MediaRoutingSection
        udid="android:emulator-5554"
        open
        onOpenChange={noop}
        state={mediaState}
        loading={false}
        pending={null}
        restartRequired={false}
        error={null}
        onApply={noop}
      />,
    );

    expect(html).not.toContain('aria-label="Output volume"');
    expect(html).not.toContain('aria-label="Simulator volume"');
  });
});
