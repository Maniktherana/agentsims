import { BunContext } from "@effect/platform-bun";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
	AxStreamers,
	type AxStreamerCache,
} from "../../accessibility/snapshot";
import {
	ApplicationCommands,
	type ApplicationCommandsService,
} from "../../commands/device-commands";
import {
	MediaCommands,
	type MediaOperations,
} from "../../commands/media-commands";
import type { ForegroundApp } from "../../shared/foreground-app";
import type { DeviceState } from "../../shared/state";
import { ForegroundApps } from "../../server/devices/foreground-apps";
import { DeviceLifecycleService } from "../../server/devices/device-lifecycle";
import { AndroidDevTools } from "../../server/devtools/android";
import { DevToolsLive } from "../../server/devtools/service";
import { webKitDevToolsLayer } from "../../server/devtools/webkit";
import { httpApplicationLive } from "../../server/http/application";
import type { WebKitBridge } from "../../server/http/devtools-bridge";
import {
	serverServicesLive,
	type HttpServerOptions,
} from "../../server/http/server";
import { MediaRouting } from "../../server/media/service";
import { ScreenshotOperationsLive } from "../../server/screenshot/operations";
import type { PreviewServer } from "../../server/runtime/runtime";
import { ScreenshotStore } from "../../server/screenshot/store";
import type { ScreenshotStoreService } from "../../server/screenshot/store";

export type TestServerOverrides = Partial<HttpServerOptions> & {
	axStreamers?: AxStreamerCache;
	readDeviceStates?: () => Promise<DeviceState[]>;
	readForegroundApp?: (device: string) => Promise<ForegroundApp | null>;
	deviceCommands?: ApplicationCommandsService;
	mediaOperations?: MediaOperations;
	getBridge?: () => Promise<WebKitBridge>;
	saveScreenshot?: ScreenshotStoreService["save"];
};

async function freePort(): Promise<number> {
	const { promise, resolve: done, reject } = Promise.withResolvers<number>();
	const server = createServer();
	server.once("error", reject);
	server.listen(0, "127.0.0.1", () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			server.close();
			reject(new Error("No TCP test port"));
			return;
		}
		server.close(() => done(address.port));
	});
	return promise;
}

export async function startTestServer(
	test: TestServerOverrides = {},
): Promise<{ origin: string; server: PreviewServer; port: number }> {
	const port = await freePort();
	const options: HttpServerOptions = {
		basePath: test.basePath ?? "/",
		proxyHelpers: test.proxyHelpers ?? true,
		previewRoot:
			test.previewRoot ?? resolve(import.meta.dir, "../../../dist/preview"),
		execToken: test.execToken ?? "test-token",
		agentsimsBin: test.agentsimsBin ?? "agentsims",
		host: test.host ?? "127.0.0.1",
		port,
		device: test.device,
		codec: test.codec,
		previewAssets: test.previewAssets,
	};
	const LifecycleTest = test.readDeviceStates
		? Layer.succeed(DeviceLifecycleService, {
				invalidate: () => {},
				reconcileCatalogState: () => {},
				isStartSuppressed: () => false,
				states: test.readDeviceStates,
				select: (states, device) =>
					device
						? (states.find((state) => state.device === device) ?? null)
						: (states[0] ?? null),
				start: async (device) => ({ error: null, device }),
				shutdown: async () => null,
			})
		: Layer.empty;
	const CommandsTest = test.deviceCommands
		? Layer.succeed(ApplicationCommands, test.deviceCommands)
		: Layer.empty;
	const ForegroundTest = test.readForegroundApp
		? Layer.mock(ForegroundApps, {
				read: (device) => Effect.promise(() => test.readForegroundApp!(device)),
			})
		: Layer.empty;
	const StreamersTest = test.axStreamers
		? Layer.succeed(AxStreamers, test.axStreamers)
		: Layer.empty;
	const MediaTest = test.mediaOperations
		? Layer.succeed(MediaRouting, new MediaCommands(test.mediaOperations))
		: Layer.empty;
	const DevToolsTest = test.getBridge
		? Layer.fresh(DevToolsLive).pipe(
				Layer.provide(
					Layer.merge(
						webKitDevToolsLayer(test.getBridge),
						Layer.succeed(AndroidDevTools, {
							list: () => Effect.succeed([]),
						}),
					),
				),
			)
		: Layer.empty;
	const ScreenshotTest = test.saveScreenshot
		? Layer.fresh(ScreenshotOperationsLive).pipe(
				Layer.provide(
					Layer.mock(ScreenshotStore, { save: test.saveScreenshot }),
				),
			)
		: Layer.empty;
	const ServerTestLive = Layer.mergeAll(
		LifecycleTest,
		CommandsTest,
		ForegroundTest,
		StreamersTest,
		MediaTest,
		DevToolsTest,
		ScreenshotTest,
	);
	const TestServerLive = httpApplicationLive(options.host, options.port).pipe(
		Layer.provide(ServerTestLive),
		Layer.provide(serverServicesLive(options)),
		Layer.provide(BunContext.layer),
	);
	const runtime = ManagedRuntime.make(TestServerLive);
	await runtime.runPromise(Effect.void);
	return {
		origin: `http://127.0.0.1:${port}`,
		server: { stop: () => runtime.dispose() },
		port,
	};
}
