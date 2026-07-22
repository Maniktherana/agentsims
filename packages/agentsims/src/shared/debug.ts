import createDebug from "debug";

// Namespaces are scoped under `agentsims:*` so `DEBUG=agentsims*` enables all
// of them. The most common stream-died debugging path is:
//   agentsims:state    — state file lifecycle (helper alive? sim booted?)
//   agentsims:helper   — helper spawn / readiness / exit
//   agentsims:mw       — middleware state selection + stale-helper recycling
//   agentsims:cli      — top-level command dispatch
export const debugCli = createDebug("agentsims:cli");
export const debugHelper = createDebug("agentsims:helper");
export const debugState = createDebug("agentsims:state");
export const debugMw = createDebug("agentsims:mw");
