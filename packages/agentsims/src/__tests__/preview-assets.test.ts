import { describe, expect, test } from "bun:test";
import type { IncomingMessage, ServerResponse } from "http";
import { simMiddleware } from "../middleware";
import {
  assertPreviewDynamicImportsEmbedded,
  assertPreviewManifestAssetsEmbedded,
  enumeratePreviewDynamicImports,
  type PreviewAssetMap,
} from "../shared/preview-assets";

async function getPreviewAsset(
  previewAssets: PreviewAssetMap,
  url: string,
) {
  const middleware = simMiddleware({
    basePath: "/",
    execToken: "preview-asset-test",
    previewAssets,
  });
  const request = { method: "GET", url, headers: {} } as IncomingMessage;
  let status = 0;
  let headers: Record<string, string> = {};
  let body = Buffer.alloc(0);
  const response = {
    writeHead(nextStatus: number, nextHeaders?: Record<string, string>) {
      status = nextStatus;
      headers = nextHeaders ?? {};
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
      return this;
    },
  } as unknown as ServerResponse;
  await middleware(request, response);
  return { status, headers, body };
}

describe("embedded preview assets", () => {
  test("serves the entry and every emitted dynamic import with browser MIME types", async () => {
    const javascript = {
      "assets/client-a0.js": 'const theme = () => import("./pierre-light-a1.js");',
      "assets/pierre-light-a1.js": 'const grammar = () => import("./tsx-b2.js");',
      "assets/tsx-b2.js": 'import { token } from "./client-a0.js"; export default token;',
    };
    const previewAssets: PreviewAssetMap = {
      "assets/client-a0.js": Buffer.from(
        javascript["assets/client-a0.js"],
      ).toString("base64"),
      "assets/pierre-light-a1.js": Buffer.from(
        javascript["assets/pierre-light-a1.js"],
      ).toString("base64"),
      "assets/tsx-b2.js": Buffer.from(javascript["assets/tsx-b2.js"]).toString("base64"),
    };
    const imports = assertPreviewDynamicImportsEmbedded(javascript, previewAssets);
    expect(enumeratePreviewDynamicImports(javascript)).toEqual(imports);
    const manifestImports = assertPreviewManifestAssetsEmbedded({
      "src/client.tsx": {
        file: "assets/client-a0.js",
        isEntry: true,
        dynamicImports: ["_pierre-light.js"],
      },
      "_pierre-light.js": {
        file: "assets/pierre-light-a1.js",
        dynamicImports: ["_tsx.js"],
      },
      "_tsx.js": { file: "assets/tsx-b2.js" },
    }, previewAssets);
    expect(manifestImports).toEqual([
      "assets/client-a0.js",
      "assets/pierre-light-a1.js",
      "assets/tsx-b2.js",
    ]);

    for (const assetKey of manifestImports) {
      const response = await getPreviewAsset(previewAssets, `/${assetKey}`);
      expect(response.status).toBe(200);
      expect(response.headers["Content-Type"]).toBe(
        "text/javascript; charset=utf-8",
      );
      expect(response.body.toString().trim().length).toBeGreaterThan(0);
    }
  });

  test("fails the build contract when a local dynamic import is omitted", () => {
    expect(() => assertPreviewDynamicImportsEmbedded(
      { "client.js": 'import("./assets/missing.js")' },
      {},
    )).toThrow("assets/missing.js");
  });
});
