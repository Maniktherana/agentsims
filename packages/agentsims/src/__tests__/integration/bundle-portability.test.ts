import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// The published launcher must locate the optional platform package from the
// npm installation. It must not contain the build machine's checkout path.

const PKG_DIR = join(import.meta.dir, "../../..");
const BUNDLES = ["dist/agentsims.js"] as const;

// CI builds dist before running this directory; locally, run
// `bun run build.ts` first or the suite skips.
const describeIfBuilt = BUNDLES.every((b) => existsSync(join(PKG_DIR, b)))
  ? describe
  : describe.skip;

describeIfBuilt("bundle portability", () => {
  test.each([...BUNDLES])("%s has no build-machine path baked in", (bundle) => {
    const js = readFileSync(join(PKG_DIR, bundle), "utf-8");
    expect(js).not.toContain(PKG_DIR);
  });
});
