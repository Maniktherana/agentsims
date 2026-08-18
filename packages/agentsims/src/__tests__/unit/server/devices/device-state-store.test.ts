import { expect, test } from "bun:test";
import { BunContext } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DeviceStateStore,
	deviceStateStoreLayer,
} from "../../../../server/devices/device-state-store";

test("DeviceStateStore uses platform filesystem services", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-state-"));
	const state = {
		pid: 1,
		port: 3200,
		device: "ios",
		url: "http://x",
		streamUrl: "http://x/s",
		wsUrl: "ws://x",
	};
	try {
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const store = yield* DeviceStateStore;
				yield* store.write(state);
				const files = yield* store.listFiles();
				const stored = yield* store.read(files[0]!);
				yield* store.remove(state.device);
				return { stored, remaining: yield* store.listFiles() };
			}).pipe(
				Effect.provide(
					deviceStateStoreLayer(directory, 1).pipe(
						Layer.provide(BunContext.layer),
					),
				),
			),
		);
		expect(result).toEqual({ stored: state, remaining: [] });
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
