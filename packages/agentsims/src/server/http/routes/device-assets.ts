import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import {
	readDeviceFrameAsset,
	readDevicePlaceholderAsset,
	type DeviceAssetResult,
} from "../../../core/ios/device-assets";
import { requestSource } from "./shared";

function requestUrl(source: unknown): URL {
	return new URL(requestSource(source).url);
}

function assetResponse(result: DeviceAssetResult): Response {
	if (!result.ok) {
		const status =
			result.kind === "invalid-request"
				? 400
				: result.kind === "not-found"
					? 404
					: 500;
		return Response.json({ ok: false, error: result.error }, { status });
	}
	return new Response(result.bytes.slice().buffer as ArrayBuffer, {
		headers: {
			"Content-Type": "image/png",
			"Cache-Control": "public, max-age=604800, immutable",
			"Content-Length": String(result.bytes.byteLength),
		},
	});
}

export const deviceAssetRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/grid/api/device-frame-assets",
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const url = requestUrl(request.source);
			return HttpServerResponse.raw(
				assetResponse(
					yield* Effect.promise(() =>
						readDeviceFrameAsset(
							url.searchParams.get("frame") ?? "",
							url.searchParams.get("image") ?? "",
						),
					),
				),
			);
		}),
	),
	HttpRouter.get(
		"/grid/api/device-placeholder-asset",
		Effect.gen(function* () {
			const request = yield* HttpServerRequest.HttpServerRequest;
			const url = requestUrl(request.source);
			return HttpServerResponse.raw(
				assetResponse(
					yield* Effect.promise(() =>
						readDevicePlaceholderAsset(url.searchParams.get("name") ?? ""),
					),
				),
			);
		}),
	),
);
