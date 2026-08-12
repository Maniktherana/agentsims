import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  partitionDevicePickerDevices,
  reconcileDevicePhaseAnnouncements,
  WorkspaceHeader,
} from "../web/components/workspace-header";
import { AGENTSIMS_REPO_URL, AgentsimsBrandLink } from "../web/components/agentsims-brand-link";
import type { GridDevice } from "../web/utils/grid";

const devices: GridDevice[] = [
  {
    device: "ios-one",
    name: "iPhone 16",
    runtime: "iOS-26-5",
    state: "Booted",
    helper: {
      port: 3211,
      url: "http://localhost:3211",
      streamUrl: "http://localhost:3211/stream.mjpeg",
      wsUrl: "ws://localhost:3211",
    },
  },
  {
    device: "android:emulator-5554",
    name: "Pixel 10",
    runtime: "Android-17",
    state: "Shutdown",
    helper: null,
  },
];

const noop = () => {};

function renderHeader(override: Partial<Parameters<typeof WorkspaceHeader>[0]> = {}) {
  return renderToStaticMarkup(
    <WorkspaceHeader
      pickerOpen
      onPickerOpenChange={noop}
      devices={devices}
      total={devices.length}
      hasMore={false}
      onLoadMore={noop}
      onLoadAll={noop}
      onResetPage={noop}
      selectedUdid="ios-one"
      visibleUdids={new Set(["ios-one"])}
      streamingByDevice={{ "ios-one": true }}
      onSelect={noop}
      settingsUdid="ios-one"
      onSettingsSelect={noop}
      onToggleVisible={noop}
      onStart={noop}
      starting={{}}
      shuttingDown={{}}
      onShutdown={noop}
      toolsOpen={false}
      onToggleTools={noop}
      hasActiveDevice
      {...override}
    />,
  );
}

describe("WorkspaceHeader", () => {
  test("keeps every transitional device in Running and only settled shutdowns in Available", () => {
    const booting = {
      ...devices[1]!,
      device: "ios-booting",
      name: "iPhone booting",
    };
    const connecting = {
      ...devices[1]!,
      device: "ios-connecting",
      name: "iPhone connecting",
      state: "Booted",
    };
    const shutting = {
      ...devices[0]!,
      device: "ios-shutting",
      name: "iPhone shutting",
      helper: null,
    };
    const partitioned = partitionDevicePickerDevices(
      [devices[0]!, devices[1]!, booting, connecting, shutting],
      { [booting.device]: true },
      { [shutting.device]: true },
    );

    expect(partitioned.runningDevices.map((device) => device.device)).toEqual([
      "ios-one",
      "ios-booting",
      "ios-connecting",
      "ios-shutting",
    ]);
    expect(partitioned.availableDevices.map((device) => device.device)).toEqual([
      "android:emulator-5554",
    ]);
  });

  test("moves shutdown progress to Available only after the action settles", () => {
    const shutting = { ...devices[0]!, helper: null };
    expect(
      partitionDevicePickerDevices([shutting], {}, { [shutting.device]: true }).runningDevices,
    ).toHaveLength(1);

    const settled = { ...shutting, state: "Shutdown" };
    expect(partitionDevicePickerDevices([settled], {}, {})).toEqual({
      runningDevices: [],
      availableDevices: [settled],
    });
  });

  test("keeps native simulator transitions in Running after reload", () => {
    const nativeTransitions = ["Booting", "Creating", "Shutting Down"].map((state, index) => ({
      ...devices[1]!,
      device: `native-transition-${index}`,
      state,
    }));
    const partitioned = partitionDevicePickerDevices(nativeTransitions, {}, {});
    expect(partitioned.runningDevices).toEqual(nativeTransitions);
    expect(partitioned.availableDevices).toEqual([]);
  });

  test("announces only phase changes and includes settled completion", () => {
    const initial = reconcileDevicePhaseAnnouncements(null, [devices[1]!], {}, {});
    expect(initial.announcement).toBe("");

    const unchanged = reconcileDevicePhaseAnnouncements(initial.phases, [devices[1]!], {}, {});
    expect(unchanged.announcement).toBe("");

    const bootingDevice = { ...devices[1]!, state: "Booting" };
    const booting = reconcileDevicePhaseAnnouncements(unchanged.phases, [bootingDevice], {}, {});
    expect(booting.announcement).toBe("Pixel 10: Booting… · Android 17");

    const settledDevice = { ...bootingDevice, state: "Shutdown" };
    const settled = reconcileDevicePhaseAnnouncements(booting.phases, [settledDevice], {}, {});
    expect(settled.announcement).toBe("Pixel 10: Available · Android 17");
  });

  test("keeps running and available devices in one picker", () => {
    const html = renderHeader();
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Running");
    expect(html).toContain("Available");
    expect(html).toContain("iPhone 16");
    expect(html).toContain("Pixel 10");
    expect(html).toContain("overflow-x-hidden overflow-y-auto");
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(html).not.toContain(">Add sim</button>");
  });

  test("uses live transport only for the selected visible row", () => {
    const staleHelperDevice = {
      ...devices[0]!,
      device: "ios-stale-helper",
      name: "Stale helper",
    };
    const html = renderHeader({
      devices: [devices[0]!, staleHelperDevice],
      total: 2,
      selectedUdid: "ios-one",
      visibleUdids: new Set(["ios-one", "ios-stale-helper"]),
      streamingByDevice: { "ios-one": false, "ios-stale-helper": false },
    });

    expect(html).toContain('aria-label="iPhone 16, Connecting… · iOS 26.5"');
    expect(html).toContain('aria-label="Stale helper, Streaming · iOS 26.5"');
  });

  test("renders row skeletons while devices load", () => {
    const html = renderHeader({ devices: null, total: 0 });
    expect(html).toContain('data-testid="device-list-skeleton"');
    expect(html).toContain('data-testid="device-row-skeleton"');
  });

  test("keeps global actions in one bottom workspace dock", () => {
    const html = renderHeader();
    expect(html).toContain('id="agentsims-workspace-dock"');
    expect(html).toContain('aria-label="Devices, 1 shown"');
    expect(html).toContain('aria-label="Device settings"');
    expect(html).not.toContain('aria-label="Add simulator"');
    expect(html).not.toContain('aria-label="WebKit DevTools"');
  });

  test("mounts Settings inside the same expanded dock", () => {
    const html = renderHeader({ pickerOpen: false, toolsOpen: true });
    expect(html).toContain('id="agentsims-tools-dock-slot"');
    expect(html).toContain('data-expanded="true"');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Settings device"');
    expect(html).toContain('data-variant="ghost"');
    expect(html).toContain('data-slot="tabs-indicator"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("iPhone 16");
  });

  test("keeps product identity outside the action dock and links the project repository", () => {
    const html = renderToStaticMarkup(<AgentsimsBrandLink />);
    expect(html).toContain(`href="${AGENTSIMS_REPO_URL}"`);
    expect(AGENTSIMS_REPO_URL).toBe("https://github.com/maniktherana/agentsims");
  });
});
