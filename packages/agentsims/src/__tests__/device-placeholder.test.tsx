import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DevicePlaceholder } from "../web/components/device-placeholder";
import { resolveSimulatorDeviceLayout } from "../web/utils/simulator-device-layout";
import { restoredSimulatorFrameWidth } from "../web/utils/simulator-resize";
import type {
  DeviceKitChromeDescriptor,
  DevicePlaceholderAssetDescriptor,
} from "../web/utils/grid";

function renderPlaceholder({
  name = "Apple Vision Pro",
  runtime = "xrOS-26-5",
  chrome = null,
  placeholderAsset = null,
}: {
  name?: string;
  runtime?: string;
  chrome?: DeviceKitChromeDescriptor | null;
  placeholderAsset?: DevicePlaceholderAssetDescriptor | null;
} = {}) {
  return renderToStaticMarkup(
    <DevicePlaceholder
      name={name}
      runtime={runtime}
      chrome={chrome}
      placeholderAsset={placeholderAsset}
      busy={false}
      error={null}
      onStart={() => {}}
    />,
  );
}

describe("DevicePlaceholder", () => {
  test("keeps Android loading and live frames on one width and aspect model", () => {
    const loading = resolveSimulatorDeviceLayout({
      deviceName: "Pixel 10",
    });
    const live = resolveSimulatorDeviceLayout({
      deviceName: "Pixel 10",
      streamConfig: { width: 1080, height: 2424, orientation: "portrait" },
    });
    const viewport = { width: 1400, height: 900 };
    const loadingWidth = restoredSimulatorFrameWidth(
      loading.defaultWidth,
      viewport.width,
      viewport.height,
      loading.aspectRatioValue,
      1.15,
    );
    const liveWidth = restoredSimulatorFrameWidth(
      live.defaultWidth,
      viewport.width,
      viewport.height,
      live.aspectRatioValue,
      1.15,
    );
    const html = renderPlaceholder({
      name: "Pixel 10",
      runtime: "Android-17",
    });

    expect(loading.defaultWidth).toBe(live.defaultWidth);
    expect(loading.aspectRatioValue).toBe(live.aspectRatioValue);
    expect(loadingWidth).toBe(liveWidth);
    expect(html).toContain('data-device-placeholder-frame="android"');
    expect(html).toContain("width:min(100%, 320px)");
    expect(html).toContain("aspect-ratio:1080 / 2424");
  });

  test("keeps iOS loading and live frames on one width and chrome model", () => {
    const chrome = {
      identifier: "phone11",
      frame: { width: 454, height: 908 },
      body: { x: 9, y: 0, width: 436, height: 908 },
      screen: { x: 26, y: 17, width: 402, height: 874 },
      insets: { top: 18, left: 18, bottom: 18, right: 18 },
      outerCornerRadius: 80,
      innerCornerRadius: 62,
      screenRadius: 61,
      compositeImage: "PhoneComposite",
      slice: null,
      corner: null,
      buttons: [],
    } satisfies DeviceKitChromeDescriptor;
    const loading = resolveSimulatorDeviceLayout({
      deviceName: "iPhone 17",
      chrome,
    });
    const live = resolveSimulatorDeviceLayout({
      deviceName: "iPhone 17",
      chrome,
      streamConfig: { width: 402, height: 874, orientation: "portrait" },
    });
    const loadingWidth = restoredSimulatorFrameWidth(
      loading.defaultWidth,
      1400,
      900,
      loading.aspectRatioValue,
      0.9,
    );
    const liveWidth = restoredSimulatorFrameWidth(
      live.defaultWidth,
      1400,
      900,
      live.aspectRatioValue,
      0.9,
    );
    const html = renderPlaceholder({
      name: "iPhone 17",
      runtime: "iOS-26-5",
      chrome,
      placeholderAsset: {
        name: "com.apple.iphone-17-2",
        width: 950,
        height: 1024,
      },
    });

    expect(loading.defaultWidth).toBe(live.defaultWidth);
    expect(loading.aspectRatioValue).toBe(live.aspectRatioValue);
    expect(loadingWidth).toBe(liveWidth);
    expect(loading.aspectRatio).toBe("454 / 908");
    expect(html).toContain('data-device-placeholder-frame="iphone"');
    expect(html).toContain("aspect-ratio:454 / 908");
    expect(html).toContain("PhoneComposite");
    expect(html).not.toContain("grid/api/device-placeholder-asset");
  });

  test("draws all hardware buttons for composite DeviceKit chrome", () => {
    const chrome = {
      identifier: "phone11",
      frame: { width: 120, height: 140 },
      body: { x: 10, y: 10, width: 100, height: 120 },
      screen: { x: 20, y: 20, width: 80, height: 100 },
      insets: { top: 10, left: 10, bottom: 10, right: 10 },
      outerCornerRadius: 16,
      innerCornerRadius: 12,
      screenRadius: 10,
      compositeImage: "WatchComposite",
      slice: null,
      corner: null,
      buttons: [
        {
          name: "side-button",
          image: "SideButton",
          imageDown: "SideButton Dn",
          onTop: false,
          frame: { x: 110, y: 30, width: 8, height: 20 },
          hover: { x: 0.1, y: 0 },
          usagePage: 12,
          usage: 149,
        },
        {
          name: "left-side-button",
          image: "StingButton",
          imageDown: "StingButton Dn",
          onTop: true,
          frame: { x: 2, y: 44, width: 4, height: 24 },
          hover: { x: -0.1, y: 0 },
          usagePage: 65281,
          usage: 512,
        },
      ],
    } satisfies DeviceKitChromeDescriptor;

    const html = renderPlaceholder({
      name: "iPhone 17 Pro",
      runtime: "iOS-26-5",
      chrome,
    });

    // The composite pictures only the bezel; every hardware button is drawn as a
    // separate sprite (onTop above the bezel, the rest poking out behind it).
    expect(html).toContain("WatchComposite");
    expect(html).toContain("StingButton");
    expect(html).toContain("SideButton");
  });
});
