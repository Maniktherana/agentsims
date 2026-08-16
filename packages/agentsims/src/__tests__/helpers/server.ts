import { createServer } from "node:net";
import { resolve } from "node:path";
import { servePreview } from "../../server/http/server";
import type { HttpServerOptions } from "../../server/http/router";
import type { PreviewServer } from "../../server/runtime/runtime";

async function freePort(): Promise<number> {
  const { promise, resolve: done, reject } = Promise.withResolvers<number>();
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      reject(new Error("No TCP test port"));
      return;
    }
    server.close(() => done(address.port));
  });
  return promise;
}

export async function startTestServer(
  overrides: Partial<HttpServerOptions> = {},
): Promise<{ origin: string; server: PreviewServer; port: number }> {
  const port = await freePort();
  const server = await servePreview({
    basePath: "/",
    proxyHelpers: true,
    previewRoot: resolve(import.meta.dir, "../../../dist/preview"),
    execToken: "test-token",
    agentsimsBin: "agentsims",
    host: "127.0.0.1",
    port,
    ...overrides,
  });
  return { origin: `http://127.0.0.1:${port}`, server, port };
}
