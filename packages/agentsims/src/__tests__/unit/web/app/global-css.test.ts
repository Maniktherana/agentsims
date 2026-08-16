import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globalCss = readFileSync(join(import.meta.dir, "../../../../web/app/global.css"), "utf8");

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

  test("limits screenshot feedback motion to opacity and transform with a reduced-motion fallback", () => {
    expect(globalCss).toContain(".agentsims-screenshot-flash");
    expect(globalCss).toContain(".agentsims-screenshot-preview");
    expect(globalCss).toContain("transition: opacity");
    expect(globalCss).toContain("transform:");
    expect(globalCss).not.toMatch(
      /\.agentsims-screenshot-(?:flash|preview)[^{]*\{[^}]*(?:filter|backdrop-filter)/s,
    );
    expect(globalCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.agentsims-screenshot-flash[\s\S]*transition: none/,
    );
  });

  test("keeps screenshot actions external with accessible hit targets and image-only elevation", () => {
    expect(globalCss).toMatch(
      /\.agentsims-screenshot-preview-controls button\s*\{[^}]*width:\s*40px[^}]*height:\s*40px/s,
    );
    expect(globalCss).toMatch(
      /\.agentsims-screenshot-preview-image\s*\{[^}]*border:\s*2px solid #fff[^}]*box-shadow:/s,
    );
    expect(globalCss).not.toMatch(
      /\.agentsims-screenshot-preview\s*\{[^}]*box-shadow:/s,
    );
  });
});
