#!/usr/bin/env bun
/**
 * Run the built package exactly as it ships.
 *
 * Portless supplies HOST, PORT, and PORTLESS_URL. The production CLI consumes
 * those values directly, so development does not have a second Vite server,
 * HMR socket, route implementation, or WebSocket upgrade path.
 */
import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

const root = import.meta.dir;
const entry = resolve(root, "dist", "agentsims.js");
const preview = resolve(root, "dist", "preview", "index.html");

if (!existsSync(entry) || !existsSync(preview)) {
  throw new Error(
    "agentsims dev runs the production build. Run `bun run build` first.",
  );
}

await import(pathToFileURL(entry).href);
