import { FileSystem, Path } from "@effect/platform";
import { Clock, Config, Effect, Random } from "effect";

export type ScreenshotPersistence = (
	png: Uint8Array,
	deviceId: string,
) => Effect.Effect<string, unknown, FileSystem.FileSystem | Path.Path>;

export const saveScreenshotPng: ScreenshotPersistence = (png, deviceId) =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const home = yield* Config.string("HOME");
		const desktop = path.join(home, "Desktop");
		yield* fileSystem.makeDirectory(desktop, { recursive: true });

		const platform = deviceId.startsWith("android:") ? "android" : "ios";
		const timestamp = new Date(yield* Clock.currentTimeMillis)
			.toISOString()
			.replace(/[:.]/g, "-");
		const suffix = (yield* Random.nextIntBetween(0, 0x1000000))
			.toString(16)
			.padStart(6, "0");
		const name = `agentsims-${platform}-${timestamp}-${suffix}.png`;
		const destination = path.join(desktop, name);
		const temporary = path.join(desktop, `.${name}.tmp`);
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
			Effect.onInterrupt(() => remove(committed ? destination : temporary)),
			Effect.ensuring(remove(temporary)),
		);
	});
