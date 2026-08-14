import { readFileSync } from "fs";
import { resolve } from "path";
import type { DeviceState } from "../../../shared/state";
import { selectDeviceState } from "../../devices/device-lifecycle";
import {
  previewAssetContentType,
  previewAssetKeyForRequest,
  resolvePreviewAsset,
  type PreviewAssetMap,
} from "../../preview/preview-assets";
import { sendText } from "../response";
import type { RouteContext } from "../types";

type PreviewRoutesOptions = {
  previewAssets?: PreviewAssetMap;
  previewRoot: string;
  previewHtml?: string;
  execToken: string;
  readDeviceStates(): Promise<DeviceState[]>;
};

type PreviewRequestOptions = {
  exposeState(state: DeviceState): DeviceState;
  configForState(state: DeviceState): unknown;
};

export function createPreviewRoutes(options: PreviewRoutesOptions) {
  let previewHtml = options.previewHtml;
  const getPreviewHtml = () => {
    previewHtml ??= readFileSync(resolve(options.previewRoot, "index.html"), "utf-8");
    return previewHtml;
  };

  return async function handlePreviewRoutes(
    context: RouteContext,
    requestOptions: PreviewRequestOptions,
  ): Promise<boolean> {
    const { response, basePath, rawUrl, pathname, selectedDevice } = context;
    const assetKey = previewAssetKeyForRequest(rawUrl, basePath);
    const embeddedAsset = options.previewAssets
      ? resolvePreviewAsset(rawUrl, basePath, options.previewAssets)
      : null;

    if (assetKey === "" || embeddedAsset === false) {
      sendText(response, 404, "Preview asset not found");
      return true;
    }
    if (embeddedAsset) {
      response.writeHead(200, {
        "Content-Type": embeddedAsset.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      });
      response.end(Buffer.from(embeddedAsset.contentBase64, "base64"));
      return true;
    }
    if (assetKey) {
      try {
        const body = readFileSync(resolve(options.previewRoot, assetKey));
        response.writeHead(200, {
          "Content-Type": previewAssetContentType(assetKey),
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        response.end(body);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        sendText(response, 404, "Preview asset not found");
      }
      return true;
    }

    if (pathname !== basePath && pathname !== `${basePath}/`) return false;

    const states = await options.readDeviceStates();
    const state = selectDeviceState(states, selectedDevice);
    let html = getPreviewHtml();
    const previewBase = basePath === "" || basePath === "/" ? "" : basePath;
    html = html.replaceAll("/__SIM_PREVIEW_BASE__", previewBase);

    if (!state) {
      const minimal = JSON.stringify({ basePath, execToken: options.execToken });
      html = html.replace(
        "<!--__SIM_PREVIEW_CONFIG__-->",
        `<script>window.__SIM_PREVIEW__=${minimal}</script>`,
      );
    } else {
      const config = JSON.stringify(
        requestOptions.configForState(requestOptions.exposeState(state)),
      );
      html = html.replace(
        "<!--__SIM_PREVIEW_CONFIG__-->",
        `<script>window.__SIM_PREVIEW__=${config}</script>`,
      );
    }

    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(html);
    return true;
  };
}
