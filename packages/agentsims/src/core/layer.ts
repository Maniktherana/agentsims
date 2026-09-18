import { Effect, Layer } from "effect";
import { AndroidAxServersLive } from "./android/accessibility/ax-server";
import {
	AndroidCdpAdapterLive,
	AndroidDevToolsLive,
} from "./android/browser-devtools";
import { AndroidLogsLive } from "./android/device/logs";
import { AndroidToolsLive } from "./android/device/tools";
import { AndroidSessionsLive } from "./android/session/session";
import { androidSerialFromStateId } from "./android/device/identifiers";
import { getAndroidForegroundApp } from "./android/device/discovery";
import {
	IosSessions,
	IosSessionsLive,
	IosSessionsUnavailable,
} from "./ios/session";
import {
	WebKitDevToolsLive,
	WebKitDevToolsUnavailable,
} from "./ios/browser-devtools/webkit";
import { DevToolsLive } from "./tools/browser-devtools";
import { DevicesLive } from "./tools/devices/devices";
import { DeviceLifecycleLive } from "./tools/devices/lifecycle";
import { foregroundAppsLayer } from "./tools/devices/foreground-apps";
import { deviceStateStoreLayer, STATE_DIR } from "./tools/devices/state";
import { ShellExecLive } from "./tools/host-commands";
import { AppsLive } from "./tools/apps";
import { PermissionOperationsLive } from "./tools/permissions";
import { mediaRoutingLayer } from "./tools/media";
import { AxStreamersLive } from "./tools/observe/accessibility";
import { ScreenshotOperationsLive } from "./tools/observe/screenshots";
import { ScreenshotStoreLive } from "./tools/observe/screenshot-store";

/** Compose platform and domain services without importing server transports. */
export function coreServicesLayer(basePath: string) {
	const axServers = AndroidAxServersLive;
	const sessions = Layer.mergeAll(
		axServers,
		AndroidSessionsLive.pipe(Layer.provide(axServers)),
		process.platform === "darwin" ? IosSessionsLive : IosSessionsUnavailable,
	);
	const stateStore = deviceStateStoreLayer(STATE_DIR, process.pid);
	const lifecycle = DeviceLifecycleLive.pipe(
		Layer.provideMerge(Layer.merge(sessions, stateStore)),
	);
	const foregroundApps = foregroundAppsLayer(
		Effect.gen(function* () {
			const iosSessions = yield* IosSessions;
			return {
				// `/appstate` polls these every 500ms — a rejection has to stay in
				// the error channel, since a defect kills the SSE stream.
				readAndroid: (device: string) => {
					const serial = androidSerialFromStateId(device);
					return serial
						? Effect.tryPromise(() => getAndroidForegroundApp(serial)).pipe(
								Effect.orElseSucceed(() => null),
							)
						: Effect.succeed(null);
				},
				readIos: (device: string) =>
					Effect.flatMap(iosSessions.get(device), (session) =>
						Effect.tryPromise(() => session.readForeground()).pipe(
							Effect.orElseSucceed(() => null),
						),
					).pipe(
						Effect.catchTag("IosHostUnavailable", () => Effect.succeed(null)),
					),
			};
		}),
	).pipe(Layer.provide(sessions));
	const devices = DevicesLive.pipe(
		Layer.provideMerge(lifecycle),
		Layer.provide(foregroundApps),
	);
	const androidTools = AndroidToolsLive.pipe(Layer.provide(devices));
	const androidDevTools = AndroidDevToolsLive.pipe(
		Layer.provide(AndroidCdpAdapterLive),
	);
	const devTools = DevToolsLive.pipe(
		Layer.provideMerge(
			Layer.merge(
				process.platform === "darwin"
					? WebKitDevToolsLive
					: WebKitDevToolsUnavailable,
				androidDevTools,
			),
		),
	);
	return Layer.mergeAll(
		mediaRoutingLayer(basePath).pipe(Layer.provideMerge(devices)),
		foregroundApps,
		AxStreamersLive.pipe(Layer.provide(lifecycle)),
		ScreenshotOperationsLive.pipe(Layer.provideMerge(ScreenshotStoreLive)),
		devTools,
		ShellExecLive,
		androidTools,
		AppsLive.pipe(Layer.provide(androidTools)),
		PermissionOperationsLive,
		AndroidLogsLive,
	);
}
