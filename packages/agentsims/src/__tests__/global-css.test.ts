import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const globalCss = readFileSync(join(import.meta.dir, "../web/global.css"), "utf8");

describe("global CSS panel variables", () => {
  test("shares the sidebar backing color through a root CSS variable", () => {
    expect(globalCss).toContain("--agentsims-panel-bg: #181818;");
    expect(globalCss).toContain("--color-panel-bg: var(--agentsims-panel-bg);");
  });
});
