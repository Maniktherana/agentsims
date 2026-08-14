/** Runtime path injected by the generated CommonJS entrypoint. */
const DIST_DIRECTORY_KEY = "__AGENTSIMS_DIST_DIR__";

export function configuredDistDirectory(): string | null {
  const value = (globalThis as Record<string, unknown>)[DIST_DIRECTORY_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}
