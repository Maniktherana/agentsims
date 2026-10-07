import { configureWorkspaceHost } from "../../../packages/agentsims/src/web/host/workspace-host";
import { createChatgptHost } from "./host";
import "../../../packages/agentsims/src/web/main";

// The shared entry owns product composition. Its controls need the separate host routing integration.
const detach = configureWorkspaceHost(createChatgptHost());
window.addEventListener("pagehide", detach, { once: true });
