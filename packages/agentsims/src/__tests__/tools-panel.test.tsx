import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
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
});
