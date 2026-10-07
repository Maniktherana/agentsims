import { HttpRouter, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import { hostPlatformInfo } from "../../../core/host";
import { RUNTIME_CAPABILITIES } from "../../runtime/config";

export const hostRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/capabilities",
		Effect.sync(() =>
			HttpServerResponse.unsafeJson({
				...hostPlatformInfo(),
				runtime: RUNTIME_CAPABILITIES,
			}),
		),
	),
);
