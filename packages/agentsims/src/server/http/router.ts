import { HttpRouter } from "@effect/platform";
import { commandRoutes } from "./routes/commands";
import { androidRoutes } from "./routes/android";
import { hostRoutes } from "./routes/host";
import { accessibilityRoutes } from "./routes/accessibility";
import { controlRoutes } from "./routes/control";
import { deviceAssetRoutes } from "./routes/device-assets";
import { devtoolsRoutes } from "./routes/devtools";
import { helperRoutes } from "./routes/helpers";
import { previewRoutes } from "./routes/preview";

const routes = HttpRouter.concatAll(
	commandRoutes,
	androidRoutes,
	hostRoutes,
	accessibilityRoutes,
	deviceAssetRoutes,
	controlRoutes,
	devtoolsRoutes,
	helperRoutes,
	previewRoutes,
);

/** Build the route table once per server. Legacy command paths remain available. */
export function routesForBasePath(basePath: string) {
	return !basePath || basePath === "/"
		? routes
		: HttpRouter.concat(
				commandRoutes,
				HttpRouter.prefixAll(routes, basePath as `/${string}`),
			);
}
