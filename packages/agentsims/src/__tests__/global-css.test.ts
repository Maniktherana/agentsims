import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globalCss = readFileSync(join(import.meta.dir, "../web/global.css"), "utf8");

describe("global CSS panel variables", () => {
  test("shares the sidebar backing color through a root CSS variable", () => {
    expect(globalCss).toContain("--agentsims-panel-bg: #181818;");
    expect(globalCss).toContain("--color-panel-bg: var(--agentsims-panel-bg);");
  });

  test("uses an OKLCH accent only for running-device screens", () => {
    expect(globalCss).toContain(
      "--agentsims-device-screen-on: oklch(0.58 0.1 245);",
    );
    expect(globalCss).not.toContain("--agentsims-device-tile-running:");
    expect(globalCss).not.toContain("--agentsims-device-glyph-running:");
  });

  test("defines the shared interaction accent in OKLCH", () => {
    expect(globalCss).toContain(
      "--agentsims-accent: oklch(0.625 0.205 256);",
    );
    expect(globalCss).toContain("--color-accent: var(--agentsims-accent);");
    expect(globalCss).not.toContain("--agentsims-accent: #0a84ff;");
  });
});
