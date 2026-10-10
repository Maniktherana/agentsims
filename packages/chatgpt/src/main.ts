import { App } from "@modelcontextprotocol/ext-apps";
import { configureWorkspaceHost } from "../../agentsims/src/web/host/workspace-host";
import { createChatgptHost } from "./host";
import { PANEL_ORIGIN, installPanelTransport } from "./panel-transport";

declare const __AGENTSIMS_VERSION__: string | undefined;

// Connect to the host and route the workspace's server traffic through MCP
// before the workspace UI loads. The UI itself is the normal browser workspace.
const app = new App(
	{ name: "Agentsims", version: typeof __AGENTSIMS_VERSION__ === "string" ? __AGENTSIMS_VERSION__ : "0.1.0" },
	{},
	{ autoResize: false, strict: true },
);
const host = createChatgptHost({ app });
const detach = configureWorkspaceHost(host);
window.addEventListener("pagehide", detach, { once: true });
await host.connect();
installPanelTransport(app);

// The server injects this config into the workspace page. The panel reads the same page.
const page = await (await fetch(`${PANEL_ORIGIN}/`)).text();
const injected = page.match(/window\.__SIM_PREVIEW__=(\{.*?\})<\/script>/)?.[1];
window.__SIM_PREVIEW__ = {
	...(injected ? JSON.parse(injected) : { basePath: "" }),
	// The panel has no AVCC transport. iOS video uses newest-frame JPEG reads.
	codec: "mjpeg",
} as Window["__SIM_PREVIEW__"];

await import("../../agentsims/src/web/main");
