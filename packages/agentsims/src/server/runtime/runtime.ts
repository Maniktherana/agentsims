/** Runtime helpers for the Bun CLI. */
import { createServer } from "node:net";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function dirnameOf(metaUrl: string): string {
  return dirname(fileURLToPath(metaUrl));
}


/** Briefly bind to a port to determine whether it is available. */
export function isPortFree(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const server = createServer();
  server.once("error", () => resolve(false));
  server.once("listening", () => server.close(() => resolve(true)));
  server.listen(port);
  return promise;
}

export interface PreviewServer {
  stop(force?: boolean): Promise<void>;
}
