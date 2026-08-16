import { FileSystem, Path } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import type { DeviceState } from "../shared/state";

export type DeviceStateStoreService = {
	write(state: DeviceState): Effect.Effect<void, unknown>;
	remove(device: string): Effect.Effect<void, unknown>;
	listFiles(): Effect.Effect<string[]>;
	read(file: string): Effect.Effect<DeviceState, unknown>;
};

export class DeviceStateStore extends Context.Tag(
	"@agentsims/DeviceStateStore",
)<DeviceStateStore, DeviceStateStoreService>() {}

export const deviceStateStoreLayer = (directory: string, pid: number) =>
	Layer.effect(
		DeviceStateStore,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const fileFor = (device: string) =>
				path.join(directory, `server-${device}.json`);
			return DeviceStateStore.of({
				write: (state) =>
					Effect.gen(function* () {
						yield* fs.makeDirectory(directory, { recursive: true });
						const file = fileFor(state.device);
						const temporary = `${file}.${pid}.tmp`;
						yield* fs.writeFileString(
							temporary,
							JSON.stringify(state, null, 2),
						);
						yield* fs.rename(temporary, file);
					}),
				remove: (device) =>
					fs.remove(fileFor(device)).pipe(Effect.catchAll(() => Effect.void)),
				listFiles: () =>
					fs.readDirectory(directory).pipe(
						Effect.map((files) =>
							files
								.filter(
									(file) =>
										file.startsWith("server-") && file.endsWith(".json"),
								)
								.map((file) => path.join(directory, file)),
						),
						Effect.catchAll(() => Effect.succeed([])),
					),
				read: (file) =>
					fs.readFileString(file).pipe(
						Effect.flatMap((text) =>
							Effect.try({
								try: () => JSON.parse(text) as DeviceState,
								catch: (error) => error,
							}),
						),
					),
			});
		}),
	);
