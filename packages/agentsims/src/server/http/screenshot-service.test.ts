import { describe, expect, test } from "bun:test";
import { BunContext } from "@effect/platform-bun";
import { ConfigProvider, Effect } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { saveScreenshotPng } from "./screenshot-service";

describe("saveScreenshotPng", () => {
  test("atomically stores the PNG under the configured home directory", async () => {
    const home = mkdtempSync(join(tmpdir(), "agentsims-screenshot-"));
    try {
      const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
      const destination = await Effect.runPromise(
        saveScreenshotPng(png, "android:emulator-5554").pipe(
          Effect.provide(BunContext.layer),
          Effect.withConfigProvider(ConfigProvider.fromMap(new Map([["HOME", home]]))),
        ),
      );

      expect(destination.startsWith(join(home, "Desktop", "agentsims-android-"))).toBe(true);
      expect(destination.endsWith(".png")).toBe(true);
      expect(existsSync(destination)).toBe(true);
      expect(readFileSync(destination)).toEqual(Buffer.from(png));
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
