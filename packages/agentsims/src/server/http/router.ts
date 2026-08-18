import { FileSystem, HttpApiBuilder, HttpRouter } from "@effect/platform";
import { Effect } from "effect";
import { ServerConfig } from "../runtime/server-config";
import { AxStreamers } from "../../accessibility/snapshot";
import { AndroidSessions } from "../../android/session/session";
import { IosSessions } from "../../ios/session/session";
import { ShellExec } from "../runtime/shell-exec";
import { ForegroundApps } from "../devices/foreground-apps";
import { DeviceLifecycleService } from "../devices/device-lifecycle";
import { DevTools } from "../devtools/service";
import { ScreenshotOperations } from "../screenshot/operations";
import { accessibilityRoutes } from "./routes/accessibility";
import { controlRoutes } from "./routes/control";
import { deviceAssetRoutes } from "./routes/device-assets";
import { devtoolsRoutes } from "./routes/devtools";
import { helperRoutes } from "./routes/helpers";
import { previewRoutes } from "./routes/preview";

export const featureRoutes = HttpRouter.concatAll(
	accessibilityRoutes,
	deviceAssetRoutes,
	controlRoutes,
	devtoolsRoutes,
	helperRoutes,
	previewRoutes,
);

export const FeatureRoutesLive = HttpApiBuilder.Router.use((router) =>
	Effect.gen(function* () {
		const config = yield* ServerConfig;
		const routes = featureRoutes.pipe(
			HttpRouter.provideService(AxStreamers, yield* AxStreamers),
			HttpRouter.provideService(AndroidSessions, yield* AndroidSessions),
			HttpRouter.provideService(IosSessions, yield* IosSessions),
			HttpRouter.provideService(ShellExec, yield* ShellExec),
			HttpRouter.provideService(ForegroundApps, yield* ForegroundApps),
			HttpRouter.provideService(
				DeviceLifecycleService,
				yield* DeviceLifecycleService,
			),
			HttpRouter.provideService(DevTools, yield* DevTools),
			HttpRouter.provideService(
				ScreenshotOperations,
				yield* ScreenshotOperations,
			),
			HttpRouter.provideService(ServerConfig, config),
			HttpRouter.provideService(
				FileSystem.FileSystem,
				yield* FileSystem.FileSystem,
			),
		);
		if (config.basePath === "") yield* router.concat(routes);
		else yield* router.mount(config.basePath, routes);
	}),
);
