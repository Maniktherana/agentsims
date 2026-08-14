import { simEndpoint } from "../../app/sim-endpoint";

export async function saveScreenshotToHost(
  blob: Blob,
  deviceId: string,
  signal: AbortSignal,
): Promise<string> {
  const token = window.__SIM_PREVIEW__?.execToken ?? "";
  const endpoint = new URL(simEndpoint("screenshot/save"), window.location.href);
  endpoint.searchParams.set("device", deviceId);
  endpoint.searchParams.set("id", crypto.randomUUID());
  const headers = { Authorization: `Bearer ${token}` };
  const requestController = new AbortController();
  const cancel = () => {
    void fetch(endpoint, {
      method: "DELETE",
      headers,
      keepalive: true,
    }).catch(() => {});
    requestController.abort(signal.reason);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "image/png",
      },
      body: blob,
      signal: requestController.signal,
    });
    const payload = await response.json() as { path?: string; error?: string };
    if (!response.ok || !payload.path) {
      throw new Error(payload.error ?? `Screenshot save failed (${response.status})`);
    }
    return payload.path;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
