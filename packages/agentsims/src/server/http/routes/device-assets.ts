import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect } from "effect";
import {
  serveDeviceKitChromeAssetWeb,
  serveDevicePlaceholderAssetWeb,
} from "../../devices/devicekit-chrome";
import { requestSource } from "./shared";

function requestUrl(source: unknown): URL {
  return new URL(requestSource(source).url);
}

export const deviceAssetRoutes = HttpRouter.empty.pipe(
  HttpRouter.get("/grid/api/devicekit-chrome", Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return HttpServerResponse.raw(
      yield* Effect.promise(() => serveDeviceKitChromeAssetWeb(requestUrl(request.source))),
    );
  })),
  HttpRouter.get("/grid/api/device-placeholder-asset", Effect.gen(function*() {
    const request = yield* HttpServerRequest.HttpServerRequest;
    return HttpServerResponse.raw(
      yield* Effect.promise(() => serveDevicePlaceholderAssetWeb(requestUrl(request.source))),
    );
  })),
);
