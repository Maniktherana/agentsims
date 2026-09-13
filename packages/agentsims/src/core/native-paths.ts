import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export function dirnameOf(metaUrl: string): string {
	return dirname(fileURLToPath(metaUrl));
}

const DIST_DIRECTORY_KEY = "__AGENTSIMS_DIST_DIR__";

export function configureDistDirectory(directory: string): void {
	(globalThis as Record<string, unknown>)[DIST_DIRECTORY_KEY] = directory;
}

export function configuredDistDirectory(): string | null {
	const value = (globalThis as Record<string, unknown>)[DIST_DIRECTORY_KEY];
	return typeof value === "string" && value.length > 0 ? value : null;
}
