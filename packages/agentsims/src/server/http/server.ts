import { BunContext, BunHttpServer } from "@effect/platform-bun";
import { HttpServer } from "@effect/platform";
import { Effect, Layer, ManagedRuntime } from "effect";
import { AxStreamersLive } from "../../accessibility/snapshot";
import { AndroidAxServersLive } from "../../android/accessibility/ax-server";
import { AndroidSessionsLive } from "../../android/session/session";
import { DevicesLive } from "../devices/service";
import {
	IosSessionsLive,
	IosSessionsUnavailable,
} from "../../ios/session/session";
import { STATE_DIR } from "../../shared/state";
import { deviceStateStoreLayer } from "../devices/device-state-store";
import { DeviceLifecycleLive } from "../devices/device-lifecycle";
import { ForegroundAppsLive } from "../devices/foreground-apps";
import {
	AndroidCdpAdapterLive,
	AndroidDevToolsLive,
} from "../devtools/android";
import { DevToolsLive } from "../devtools/service";
import {
	WebKitDevToolsLive,
	WebKitDevToolsUnavailable,
} from "../devtools/webkit";
import { MediaRoutingLive } from "../media/service";
import { ScreenshotOperationsLive } from "../screenshot/operations";
import { ScreenshotStoreLive } from "../screenshot/store";
import { ShellExecLive } from "../runtime/shell-exec";
import {
	ServerConfig,
	serverConfigLayer,
	type ServerConfigInput,
} from "../runtime/server-config";
import { routesForBasePath } from "./router";
import { AndroidToolsLive } from "../../android/device/tools";
import { AndroidLogsLive } from "../../android/device/logs";

export interface PreviewServer {
	stop(force?: boolean): Promise<void>;
}

export type HttpServerOptions = ServerConfigInput;

export function serverServicesLive(options: HttpServerOptions) {
	const configLive = serverConfigLayer(options);
	const axServersLive = AndroidAxServersLive;
	const sessionsLive = Layer.mergeAll(
		axServersLive,
		AndroidSessionsLive.pipe(Layer.provide(axServersLive)),
		process.platform === "darwin" ? IosSessionsLive : IosSessionsUnavailable,
	);
	const stateStoreLive = deviceStateStoreLayer(STATE_DIR, process.pid);
	const lifecycleDependenciesLive = Layer.merge(sessionsLive, stateStoreLive);
	const coreLive = DeviceLifecycleLive.pipe(
		Layer.provideMerge(lifecycleDependenciesLive),
	);
	const devicesLive = DevicesLive.pipe(Layer.provideMerge(coreLive));
	const configuredDevicesLive = Layer.merge(configLive, devicesLive);
	const androidToolsLive = AndroidToolsLive.pipe(Layer.provide(devicesLive));
	const mediaLive = MediaRoutingLive.pipe(
		Layer.provideMerge(configuredDevicesLive),
	);
	const foregroundLive = ForegroundAppsLive.pipe(Layer.provide(coreLive));
	const streamersLive = AxStreamersLive.pipe(Layer.provide(coreLive));
	const screenshotsLive = ScreenshotOperationsLive.pipe(
		Layer.provideMerge(ScreenshotStoreLive),
	);
	const androidDevToolsLive = AndroidDevToolsLive.pipe(
		Layer.provide(AndroidCdpAdapterLive),
	);
	const devToolsProvidersLive = Layer.merge(
		process.platform === "darwin"
			? WebKitDevToolsLive
			: WebKitDevToolsUnavailable,
		androidDevToolsLive,
	);
	const devToolsLive = DevToolsLive.pipe(
		Layer.provideMerge(devToolsProvidersLive),
	);
	return Layer.mergeAll(
		mediaLive,
		foregroundLive,
		streamersLive,
		screenshotsLive,
		devToolsLive,
		ShellExecLive,
		androidToolsLive,
		AndroidLogsLive,
	);
}

export function httpApplicationLive(host: string, port: number) {
	return Layer.unwrapEffect(
		Effect.map(ServerConfig, (config) =>
			HttpServer.serve(routesForBasePath(config.basePath)).pipe(
				Layer.provide(
					BunHttpServer.layer({ hostname: host, port, idleTimeout: 0 }),
				),
			),
		),
	);
}

export function serverLive(options: HttpServerOptions) {
	return httpApplicationLive(options.host, options.port).pipe(
		Layer.provide(serverServicesLive(options)),
		Layer.provide(BunContext.layer),
	);
}

export async function servePreview(
	options: HttpServerOptions,
): Promise<PreviewServer> {
	const runtime = ManagedRuntime.make(serverLive(options));
	await runtime.runPromise(Effect.void);
	return { stop: () => runtime.dispose() };
}
