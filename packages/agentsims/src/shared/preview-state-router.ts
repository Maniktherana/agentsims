import { watch, type FSWatcher } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { readDeviceStates, selectDeviceState } from "./device-lifecycle";
import { debugMw } from "./debug";
import { STATE_DIR, type ServeSimDeviceState } from "./state";

type PreviewConfigFactory = (state: ServeSimDeviceState) => unknown;
type StateExposure = (state: ServeSimDeviceState) => ServeSimDeviceState;

export class PreviewStateRouter {
  private lastApiLogKey: string | undefined;

  constructor(
    private readonly base: string,
    private readonly configForState: PreviewConfigFactory,
  ) {}

  async handle(
    req: IncomingMessage,
    res: ServerResponse,
    selectedDevice: string | null,
    expose: StateExposure,
  ): Promise<boolean> {
    const pathname = (req.url ?? "").split("?", 1)[0];
    if (pathname === `${this.base}/api`) {
      await this.serveCurrent(res, selectedDevice, expose);
      return true;
    }
    if (pathname === `${this.base}/api/events`) {
      await this.streamChanges(req, res, selectedDevice, expose);
      return true;
    }
    return false;
  }

  private async currentConfig(
    selectedDevice: string | null,
    expose: StateExposure,
  ): Promise<{ states: ServeSimDeviceState[]; state: ServeSimDeviceState | null; json: string }> {
    const states = await readDeviceStates();
    const state = selectDeviceState(states, selectedDevice);
    const exposed = state ? expose(state) : null;
    return {
      states,
      state,
      json: JSON.stringify(exposed ? this.configForState(exposed) : null),
    };
  }

  private async serveCurrent(
    res: ServerResponse,
    selectedDevice: string | null,
    expose: StateExposure,
  ): Promise<void> {
    const current = await this.currentConfig(selectedDevice, expose);
    const logKey = `${selectedDevice ?? "(any)"}|${current.states.length}|${
      current.state ? `${current.state.device}@${current.state.port}` : "none"
    }`;
    if (logKey !== this.lastApiLogKey) {
      this.lastApiLogKey = logKey;
      debugMw(
        "GET /api selectedDevice=%s states=%d chose=%s",
        selectedDevice ?? "(any)",
        current.states.length,
        current.state ? `${current.state.device}@${current.state.port}` : "none",
      );
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(current.json);
  }

  private async streamChanges(
    req: IncomingMessage,
    res: ServerResponse,
    selectedDevice: string | null,
    expose: StateExposure,
  ): Promise<void> {
    const compute = async () => (await this.currentConfig(selectedDevice, expose)).json;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(":\n\n");

    let lastSent = await compute();
    res.write(`data: ${lastSent}\n\n`);
    let closed = false;
    const sendIfChanged = async () => {
      if (closed || res.writableEnded) return;
      const next = await compute();
      if (next === lastSent) return;
      lastSent = next;
      res.write(`data: ${next}\n\n`);
    };

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onFsEvent = () => {
      if (debounce) return;
      debounce = setTimeout(() => {
        debounce = null;
        void sendIfChanged();
      }, 150);
    };

    let watcher: FSWatcher | null = null;
    let watcherRetry: ReturnType<typeof setTimeout> | null = null;
    const ensureWatcher = () => {
      if (closed || res.writableEnded || watcher || watcherRetry) return;
      watcherRetry = setTimeout(() => {
        watcherRetry = null;
        if (closed || res.writableEnded || watcher) return;
        try {
          watcher = watch(STATE_DIR, onFsEvent);
          watcher.on("error", () => {
            watcher?.close();
            watcher = null;
            ensureWatcher();
          });
          void sendIfChanged();
        } catch {
          ensureWatcher();
        }
      }, 250);
    };
    ensureWatcher();

    const heartbeat = setInterval(() => {
      if (closed || res.writableEnded) return;
      res.write(":\n\n");
      ensureWatcher();
    }, 15_000);
    req.on("close", () => {
      closed = true;
      if (debounce) clearTimeout(debounce);
      if (watcherRetry) clearTimeout(watcherRetry);
      clearInterval(heartbeat);
      watcher?.close();
    });
  }
}
