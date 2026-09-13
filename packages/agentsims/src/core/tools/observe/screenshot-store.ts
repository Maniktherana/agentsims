import { FileSystem, Path } from "@effect/platform";
import { Clock, Config, Context, Effect, Layer, Random } from "effect";

export type ScreenshotStoreService = {
	save(png: Uint8Array, deviceId: string): Effect.Effect<string, unknown>;
};

export class ScreenshotStore extends Context.Tag("@agentsims/ScreenshotStore")<
	ScreenshotStore,
	ScreenshotStoreService
>() {}

export const ScreenshotStoreLive = Layer.effect(
	ScreenshotStore,
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		return ScreenshotStore.of({
			save: (png, deviceId) =>
				Effect.gen(function* () {
					const home = yield* Config.string("HOME");
					const downloads = path.join(home, "Downloads");
					yield* fileSystem.makeDirectory(downloads, { recursive: true });
					const platform = deviceId.startsWith("android:") ? "android" : "ios";
					const timestamp = new Date(yield* Clock.currentTimeMillis)
						.toISOString()
						.replace(/[:.]/g, "-");
					const suffix = (yield* Random.nextIntBetween(0, 0x1000000))
						.toString(16)
						.padStart(6, "0");
					const name = `agentsims-${platform}-${timestamp}-${suffix}.png`;
					const destination = path.join(downloads, name);
					const temporary = path.join(downloads, `.${name}.tmp`);
					let committed = false;
					const remove = (target: string) =>
						fileSystem.remove(target).pipe(Effect.ignore);
					return yield* Effect.gen(function* () {
						yield* fileSystem.writeFile(temporary, png, { flag: "wx" });
						yield* fileSystem.rename(temporary, destination).pipe(
							Effect.tap(() =>
								Effect.sync(() => {
									committed = true;
								}),
							),
							Effect.uninterruptible,
						);
						return destination;
					}).pipe(
						Effect.onInterrupt(() =>
							remove(committed ? destination : temporary),
						),
						Effect.ensuring(remove(temporary)),
					);
				}),
		});
	}),
);
