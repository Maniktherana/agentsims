import { createServer as createNetServer } from "net";

const START_PORT = 9222;

export type WebKitBridgeTarget = {
  id: string;
  title: string;
  url: string;
  type: string;
  appName?: string;
  bundleId?: string;
  udid?: string;
  inUseByOtherInspector?: boolean;
};

export type WebKitBridge = {
  port: number;
  cdpUrl: string;
  listTargets(): Promise<WebKitBridgeTarget[]>;
  highlightTarget?(targetId: string, on: boolean): Promise<void>;
  releaseHighlight?(targetId?: string): void;
};

type InspectWebKitTarget = {
  targetId: string;
  title?: string;
  appName?: string;
  url?: string;
  type?: string;
  bundleId?: string;
  inUseByOtherInspector?: boolean;
  source?: { kind?: string; id?: string };
};

type CdpListEntry = {
  id: string;
  title: string;
  url: string;
  type: string;
  description?: string;
};

let bridgePromise: Promise<WebKitBridge> | null = null;

async function isLocalPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

async function existingBridge(port: number): Promise<WebKitBridge | null> {
  const cdpUrl = `http://127.0.0.1:${port}`;
  try {
    const versionResponse = await fetch(`${cdpUrl}/json/version`);
    if (!versionResponse.ok) return null;
    const version = (await versionResponse.json()) as { Browser?: string };
    if (version.Browser !== "Safari/inspect-webkit") return null;
    return {
      port,
      cdpUrl,
      async listTargets() {
        const response = await fetch(`${cdpUrl}/json/list`);
        const targets = (await response.json()) as CdpListEntry[];
        return targets
          .filter((target) => target.id.startsWith("sim:"))
          .map((target) => {
            const idParts = target.id.split(":");
            return {
              id: target.id,
              title: target.title || target.url || "Untitled",
              url: /^https?:/i.test(target.url) ? target.url : "about:blank",
              type: target.type || "page",
              udid: idParts[1],
              bundleId: target.description?.match(/\(([^)]+)\)/)?.[1],
            };
          });
      },
    };
  } catch {
    return null;
  }
}

export async function ensureInspectWebKitBridge(): Promise<WebKitBridge> {
  if (bridgePromise) {
    try {
      await (await bridgePromise).listTargets();
      return bridgePromise;
    } catch {
      bridgePromise = null;
    }
  }

  bridgePromise = (async () => {
    const { startCdpServer } = await import("inspect-webkit");
    for (let port = START_PORT; port < START_PORT + 50; port++) {
      if (!(await isLocalPortFree(port))) {
        const existing = await existingBridge(port);
        if (existing) return existing;
        continue;
      }
      try {
        const server = (await startCdpServer({
          host: "127.0.0.1",
          port,
        })) as Awaited<ReturnType<typeof startCdpServer>> & {
          highlightTarget?(targetId: string, on: boolean): Promise<void>;
          releaseHighlight?(targetId?: string): void;
        };
        return {
          port,
          cdpUrl: `http://127.0.0.1:${port}`,
          async listTargets() {
            return (server.getTargets() as InspectWebKitTarget[])
              .filter((target) => target.source?.kind === "simulator")
              .map((target) => {
                const url = target.url ?? "";
                return {
                  id: target.targetId,
                  title: target.title || target.appName || url || "Untitled",
                  url: /^https?:/i.test(url) ? url : "about:blank",
                  type: target.type || "page",
                  appName: target.appName,
                  bundleId: target.bundleId,
                  udid: target.source?.id,
                  inUseByOtherInspector: Boolean(target.inUseByOtherInspector),
                };
              });
          },
          highlightTarget: server.highlightTarget?.bind(server),
          releaseHighlight: server.releaseHighlight?.bind(server),
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
          const existing = await existingBridge(port);
          if (existing) return existing;
          continue;
        }
        throw error;
      }
    }
    throw new Error(`No available inspect-webkit port found in ${START_PORT}-${START_PORT + 49}`);
  })().catch((error) => {
    bridgePromise = null;
    throw error;
  });
  return bridgePromise;
}
