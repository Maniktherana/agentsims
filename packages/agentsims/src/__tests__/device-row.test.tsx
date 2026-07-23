import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeviceRow } from "../web/components/device-row";
import type { GridDevice } from "../web/utils/grid";

const noop = () => {};

function render(device: GridDevice, active = false): string {
  return renderToStaticMarkup(
    <DeviceRow
      device={device}
      active={active}
      starting={false}
      shuttingDown={false}
      onSelect={noop}
      onShutdown={noop}
    />,
  );
}

describe("DeviceRow", () => {
  test("does not render a redundant Simulator status for idle devices", () => {
    const html = render({
      device: "idle",
      name: "iPhone 17",
      runtime: "iOS-27-0",
      state: "Shutdown",
      helper: null,
    });

    expect(html).toContain("iPhone 17");
    expect(html).not.toContain("Simulator");
  });

  test("keeps meaningful streaming status", () => {
    const html = render({
      device: "streaming",
      name: "iPhone 16",
      runtime: "iOS-26-5",
      state: "Booted",
      helper: {
        port: 3100,
        url: "http://localhost:3100",
        streamUrl: "http://localhost:3100/stream.mjpeg",
        wsUrl: "ws://localhost:3100/ws",
      },
    });

    expect(html).toContain("Streaming");
  });

  test("does not render a live stream thumbnail in the device list", () => {
    const html = render({
      device: "streaming",
      name: "iPhone 16",
      runtime: "iOS-26-5",
      state: "Booted",
      helper: {
        port: 3100,
        url: "http://localhost:3100",
        streamUrl: "http://localhost:3100/stream.mjpeg",
        wsUrl: "ws://localhost:3100/ws",
      },
    });

    expect(html).not.toContain("<img");
    expect(html).not.toContain("stream.mjpeg");
  });

  test("keeps streaming status green when selected", () => {
    const html = render(
      {
        device: "streaming",
        name: "iPhone 16",
        runtime: "iOS-26-5",
        state: "Booted",
        helper: {
          port: 3100,
          url: "http://localhost:3100",
          streamUrl: "http://localhost:3100/stream.mjpeg",
          wsUrl: "ws://localhost:3100/ws",
        },
      },
      true,
    );

    expect(html).toContain("Streaming");
    expect(html).toContain("text-[#34d399]");
  });

  test("uses visible eye and power actions instead of a checkbox and trailing version", () => {
    const html = renderToStaticMarkup(
      <DeviceRow
        device={{
          device: "streaming",
          name: "iPhone 16",
          runtime: "iOS-26-5",
          state: "Booted",
          helper: {
            port: 3100,
            url: "http://localhost:3100",
            streamUrl: "http://localhost:3100/stream.mjpeg",
            wsUrl: "ws://localhost:3100/ws",
          },
        }}
        active
        visible
        showVisibilityControl
        starting={false}
        shuttingDown={false}
        onSelect={noop}
        onVisibleChange={noop}
        onShutdown={noop}
      />,
    );

    expect(html).toContain('data-testid="device-row-trailing-slot"');
    expect(html).toContain('aria-label="Hide iPhone 16"');
    expect(html).toContain('aria-label="Shut down device"');
    expect(html).toContain("lucide-eye");
    expect(html).toContain("lucide-power");
    expect(html.match(/data-base-ui-tooltip-trigger/g)).toHaveLength(2);
    expect(html).toContain("hover:!text-red-400");
    expect(html).toContain("!border-transparent");
    expect(html).toContain("group/review-action");
    expect(html).not.toContain("group-hover:opacity-100");
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain(">26.5</span>");
  });

  test("does not add active or hover fills to running rows", () => {
    const html = render(
      {
        device: "streaming",
        name: "iPhone 16",
        runtime: "iOS-26-5",
        state: "Booted",
        helper: {
          port: 3100,
          url: "http://localhost:3100",
          streamUrl: "http://localhost:3100/stream.mjpeg",
          wsUrl: "ws://localhost:3100/ws",
        },
      },
      true,
    );

    expect(html).not.toContain("bg-white/10");
    expect(html).not.toContain("hover:bg-white/8");
    expect(html).toContain("focus-visible:outline-white/25");
    expect(html).toContain("bg-white/6");
    expect(html).not.toContain("agentsims-device-tile-running-selected");
    expect(html).not.toContain("bg-[#0a84ff]");
    expect(html).not.toContain("bg-[#26364c]");
    expect(html).not.toContain("shadow-[inset");
  });

});
