import { BunContext } from "@effect/platform-bun";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { Effect, Layer, ManagedRuntime } from "effect";
import {
	AxStreamers,
	type AxStreamerCache,
} from "../../core/tools/observe/accessibility";
import {
	AndroidSessions,
	type AndroidSessionsService,
} from "../../core/android/session/session";
import { Devices, type DeviceService } from "../../core/tools/devices/devices";
import { Apps, type AppsService } from "../../core/tools/apps";
import { makeMediaRouting, type MediaOperations } from "../../core/tools/media";
import type { ForegroundApp } from "../../core/tools/devices/foreground-apps";
import type { DeviceState } from "../../core/tools/devices/state";
import { ForegroundApps } from "../../core/tools/devices/foreground-apps";
import { DeviceLifecycleService } from "../../core/tools/devices/lifecycle";
import { AndroidDevTools } from "../../core/android/browser-devtools";
import { DevToolsLive } from "../../core/tools/browser-devtools";
import { webKitDevToolsLayer } from "../../core/ios/browser-devtools/webkit";
import type { WebKitBridge } from "../../core/ios/browser-devtools/bridge";
import {
	httpApplicationLive,
	serverServicesLive,
	type HttpServerOptions,
} from "../../server/http/server";
import { MediaRouting } from "../../core/tools/media";
import {
	Recordings,
	type RecordingsService,
} from "../../core/tools/recording/recordings";
import { ScreenshotOperationsLive } from "../../core/tools/observe/screenshots";
import type { PreviewServer } from "../../server/http/server";
import { ScreenshotStore } from "../../core/tools/observe/screenshot-store";
import type { ScreenshotStoreService } from "../../core/tools/observe/screenshot-store";

export type TestServerOverrides = Partial<HttpServerOptions> & {
	axStreamers?: AxStreamerCache;
	readDeviceStates?: () => Promise<DeviceState[]>;
	readForegroundApp?: (device: string) => Promise<ForegroundApp | null>;
	deviceCommands?: DeviceService;
	androidSessions?: AndroidSessionsService;
	apps?: AppsService;
	mediaOperations?: MediaOperations;
	getBridge?: () => Promise<WebKitBridge>;
	recordings?: RecordingsService;
	saveScreenshot?: ScreenshotStoreService["save"];
};

export async function freePort(): Promise<number> {
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
		? Layer.succeed(Devices, test.deviceCommands)
		: Layer.empty;
	const AndroidSessionsTest = test.androidSessions
		? Layer.succeed(AndroidSessions, test.androidSessions)
		: Layer.empty;
	const AppsTest = test.apps ? Layer.succeed(Apps, test.apps) : Layer.empty;
	const ForegroundTest = test.readForegroundApp
		? Layer.mock(ForegroundApps, {
				read: (device) => Effect.promise(() => test.readForegroundApp!(device)),
			})
		: Layer.empty;
	const StreamersTest = test.axStreamers
		? Layer.succeed(AxStreamers, test.axStreamers)
		: Layer.empty;
	const MediaTest = test.mediaOperations
		? Layer.succeed(MediaRouting, makeMediaRouting(test.mediaOperations))
		: Layer.empty;
	const RecordingsTest = test.recordings
		? Layer.succeed(Recordings, test.recordings)
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
		AndroidSessionsTest,
		AppsTest,
		ForegroundTest,
		StreamersTest,
		MediaTest,
		RecordingsTest,
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
		server: { port, stop: () => runtime.dispose() },
		port,
	};
}
