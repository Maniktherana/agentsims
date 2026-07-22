import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceHeader } from "../web/components/workspace-header";
import { AGENTSIMS_REPO_URL } from "../web/components/agentsims-brand-link";
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
      onToggleVisible={noop}
      onStart={noop}
      starting={{}}
      shuttingDown={{}}
      onShutdown={noop}
      toolsOpen={false}
      onToggleTools={noop}
      devtoolsOpen={false}
      onToggleDevtools={noop}
      devtoolsAvailable
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
    expect(html).not.toContain(">Add sim</button>");
  });

  test("renders row skeletons while devices load", () => {
    const html = renderHeader({ devices: null, total: 0 });
    expect(html).toContain('data-testid="device-list-skeleton"');
    expect(html).toContain('data-testid="device-row-skeleton"');
  });

  test("keeps branding and focused tool actions in the top bar", () => {
    const html = renderHeader();
    expect(html).toContain(`href="${AGENTSIMS_REPO_URL}"`);
    expect(html).toContain('aria-label="Simulator tools"');
    expect(html).toContain('aria-label="WebKit DevTools"');
    expect(html).toContain('aria-label="Add simulator"');
  });
});
