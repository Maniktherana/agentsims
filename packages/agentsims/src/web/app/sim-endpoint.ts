declare global {
  interface Window {
    __SIM_PREVIEW__?: {
      url: string;
      streamUrl: string;
      wsUrl: string;
      pid: number;
      port: number;
      device: string;
      basePath: string;
      axEndpoint?: string;
      appStateEndpoint?: string;
      devtoolsEndpoint?: string;
      gridApiEndpoint?: string;
      gridStartEndpoint?: string;
      gridShutdownEndpoint?: string;
      gridMemoryEndpoint?: string;
      previewEndpoint?: string;
      // Absolute path of the running agentsims entry script. The camera tool
      // shells out via `node <bin> camera ...` so it doesn't depend on the
      // `agentsims` binary being on the user's PATH.
      agentsimsBin?: string;
      /** Bearer token required by the /exec shell-exec route. */
      execToken?: string;
      /**
       * Server-pinned stream codec. `"mjpeg"` forces the software JPEG path
       * (for hosts whose hardware can't encode H.264); `"auto"`/undefined lets
       * the client pick H.264 when the browser can decode it. Reserved for
       * future values like `"hevc"`/`"av1"`.
       */
      codec?: string;
      /**
       * Set when the server routes helper stream/control + DevTools sockets
       * through its same-origin `/helper` and `/devtools` proxies. The browser
       * then re-anchors those URLs to its own origin; left unset, the config
       * already carries the helper's direct URLs and is used as-is.
       */
      proxyHelpers?: boolean;
    };
  }
}

/**
 * Narrow an injected `__SIM_PREVIEW__` to a usable stream config. The server
 * injects a minimal `{basePath, execToken}` when no helper is attached. That
 * value is not a stream config because it has no device URL.
 */
export function streamConfigFrom(
  raw: Window["__SIM_PREVIEW__"] | null | undefined,
): NonNullable<Window["__SIM_PREVIEW__"]> | null {
  return raw && typeof raw.device === "string" && typeof raw.url === "string"
    ? raw
    : null;
}

export function simEndpoint(path: string): string {
  // The injected value contains the canonical base path. During the empty
  // state, derive the mount path from the current URL. This keeps API requests
  // on the correct mount path before a helper starts.
  const configured = window.__SIM_PREVIEW__?.basePath;
  const basePath = configured ?? (window.location.pathname.replace(/\/+$/, "") || "/");
  return basePath === "/" ? `/${path}` : `${basePath}/${path}`;
}
