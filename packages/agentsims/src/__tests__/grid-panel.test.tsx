import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHeader } from "../web/components/workspace-header";
import {
  AGENTSIMS_REPO_URL,
  AgentsimsBrandLink,
} from "../web/components/agentsims-brand-link";
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
      reviewOpen={false}
      onToggleReview={noop}
      hasActiveDevice
      {...override}
    />,
  );
}

describe("WorkspaceHeader", () => {
  test("keeps running and available devices in one picker", () => {
    const html = renderHeader();
    expect(html).toContain('role="dialog"');
    expect(html).toContain("Running");
    expect(html).toContain("Available");
    expect(html).toContain("iPhone 16");
    expect(html).toContain("Pixel 10");
    expect(html).toContain("overflow-x-hidden overflow-y-auto");
    expect(html).not.toContain(">Add sim</button>");
  });

  test("renders row skeletons while devices load", () => {
    const html = renderHeader({ devices: null, total: 0 });
    expect(html).toContain('data-testid="device-list-skeleton"');
    expect(html).toContain('data-testid="device-row-skeleton"');
  });

  test("keeps global actions in one bottom workspace dock", () => {
    const html = renderHeader();
    expect(html).toContain('id="agentsims-workspace-dock"');
    expect(html).toContain('id="agentsims-review-dock-slot"');
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
