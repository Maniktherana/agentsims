import { HttpApiBuilder, HttpRouter } from "@effect/platform";
import { Effect } from "effect";
import { HttpRuntime } from "../../services/http-runtime";
import { ShellExec } from "../../services/runtime";
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
		const runtime = yield* HttpRuntime;
		const shell = yield* ShellExec;
		const routes = featureRoutes.pipe(
			HttpRouter.provideService(HttpRuntime, runtime),
			HttpRouter.provideService(ShellExec, shell),
		);
		if (runtime.basePath === "") yield* router.concat(routes);
		else yield* router.mount(runtime.basePath, routes);
	}),
);
