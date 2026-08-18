import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import { AxStreamersLive } from "../../accessibility/snapshot";
import { AndroidAxServersLive } from "../../android/accessibility/ax-server";
import { AndroidSessionsLive } from "../../android/session/session";
import { ApplicationCommandsLive } from "../../commands/device-commands";
import { IosSessionsLive } from "../../ios/session/session";
import { STATE_DIR } from "../../shared/state";
import { deviceStateStoreLayer } from "../devices/device-state-store";
import { DeviceLifecycleLive } from "../devices/device-lifecycle";
import { ForegroundAppsLive } from "../devices/foreground-apps";
import {
	AndroidCdpAdapterLive,
	AndroidDevToolsLive,
} from "../devtools/android";
import { DevToolsLive } from "../devtools/service";
import { WebKitDevToolsLive } from "../devtools/webkit";
import { MediaRoutingLive } from "../media/service";
import { ScreenshotOperationsLive } from "../screenshot/operations";
import { ScreenshotStoreLive } from "../screenshot/store";
import { ShellExecLive } from "../runtime/shell-exec";
import {
	serverConfigLayer,
	type ServerConfigInput,
} from "../runtime/server-config";
import type { PreviewServer } from "../runtime/runtime";
import { httpApplicationLive } from "./application";
import { JsonOnlyLive } from "./json-only";

export type HttpServerOptions = ServerConfigInput;

export function serverServicesLive(options: HttpServerOptions) {
	const configLive = serverConfigLayer(options);
	const axServersLive = AndroidAxServersLive;
	const sessionsLive = Layer.mergeAll(
		axServersLive,
		AndroidSessionsLive.pipe(Layer.provide(axServersLive)),
		IosSessionsLive,
	);
	const stateStoreLive = deviceStateStoreLayer(STATE_DIR, process.pid);
	const lifecycleDependenciesLive = Layer.merge(sessionsLive, stateStoreLive);
	const coreLive = DeviceLifecycleLive.pipe(
		Layer.provideMerge(lifecycleDependenciesLive),
	);
	const commandsLive = ApplicationCommandsLive.pipe(
		Layer.provideMerge(coreLive),
	);
	const configuredCommandsLive = Layer.merge(configLive, commandsLive);
	const mediaLive = MediaRoutingLive.pipe(
		Layer.provideMerge(configuredCommandsLive),
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
		WebKitDevToolsLive,
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
		JsonOnlyLive,
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
