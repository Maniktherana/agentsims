import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { simMiddleware } from "../http/server";
import {
  assertPreviewDynamicImportsEmbedded,
  assertPreviewManifestAssetsEmbedded,
  enumeratePreviewDynamicImports,
  type PreviewAssetMap,
} from "./preview-assets";

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

describe("preview assets", () => {
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

  test("serves production assets from disk and scopes generated URLs to the mount", async () => {
    const previewRoot = mkdtempSync(join(tmpdir(), "agentsims-preview-"));
    try {
      mkdirSync(join(previewRoot, "assets"));
      writeFileSync(
        join(previewRoot, "index.html"),
        '<link rel="stylesheet" href="/__SIM_PREVIEW_BASE__/assets/client.css">' +
          '<!--__SIM_PREVIEW_CONFIG__-->' +
          '<script src="/__SIM_PREVIEW_BASE__/assets/client.js"></script>',
      );
      writeFileSync(join(previewRoot, "assets", "client.js"), "export default 1;");
      writeFileSync(join(previewRoot, "assets", "client.css"), ":root{color-scheme:dark}");

      const middleware = simMiddleware({
        basePath: "/review",
        execToken: "preview-disk-test",
        previewRoot,
        readDeviceStates: async () => [],
      });
      const request = async (url: string) => {
        const req = {
          method: "GET",
          url,
          headers: { host: "localhost:3200" },
          socket: { localPort: 3200 },
        } as IncomingMessage;
        let status = 0;
        let headers: Record<string, string> = {};
        let body = Buffer.alloc(0);
        const res = {
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
        await middleware(req, res);
        return { status, headers, body };
      };

      const script = await request("/review/assets/client.js");
      expect(script.status).toBe(200);
      expect(script.headers["Content-Type"]).toBe("text/javascript; charset=utf-8");
      expect(script.body.toString()).toContain("export default 1");

      const page = await request("/review");
      expect(page.status).toBe(200);
      expect(page.body.toString()).toContain('href="/review/assets/client.css"');
      expect(page.body.toString()).toContain('src="/review/assets/client.js"');
      expect(page.body.toString()).toContain("window.__SIM_PREVIEW__=");

      expect((await request("/review/assets/%5C..%5Csecret")).status).toBe(404);
    } finally {
      rmSync(previewRoot, { recursive: true, force: true });
    }
  });
});
