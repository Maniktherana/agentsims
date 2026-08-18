import { describe, expect, test } from "bun:test";
import { BunContext } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer } from "effect";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	ScreenshotStore,
	ScreenshotStoreLive,
} from "../../../../server/screenshot/store";

describe("saveScreenshotPng", () => {
	test("atomically stores the PNG under the configured home directory", async () => {
		const home = mkdtempSync(join(tmpdir(), "agentsims-screenshot-"));
		try {
			const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
			const destination = await Effect.runPromise(
				Effect.gen(function* () {
					return yield* (yield* ScreenshotStore).save(
						png,
						"android:emulator-5554",
					);
				}).pipe(
					Effect.provide(
						ScreenshotStoreLive.pipe(Layer.provide(BunContext.layer)),
					),
					Effect.withConfigProvider(
						ConfigProvider.fromMap(new Map([["HOME", home]])),
					),
				),
			);

			expect(
				destination.startsWith(join(home, "Downloads", "agentsims-android-")),
			).toBe(true);
			expect(destination.endsWith(".png")).toBe(true);
			expect(existsSync(destination)).toBe(true);
			expect(readFileSync(destination)).toEqual(Buffer.from(png));
		} finally {
			rmSync(home, { recursive: true, force: true });
		}
	});
});
