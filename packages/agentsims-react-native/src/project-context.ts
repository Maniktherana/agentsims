import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

function agentsimsHome(): string {
	return (
		process.env.AGENTSIMS_HOME_DIR ??
		process.env.AGENTSIMS_HOME ??
		join(homedir(), ".agentsims")
	);
}

export interface RnProjectContext {
	projectRoot: string;
	projectKey: string;
	manifestPath: string;
	appIds: readonly string[];
	devices: readonly string[];
}

export function canonicalProjectRoot(root: string): string {
	const path = resolve(root);
	return existsSync(path) ? realpathSync(path) : path;
}

export function rnProjectKey(root: string): string {
	return createHash("sha1")
		.update(canonicalProjectRoot(root).replace(/\\/g, "/"))
		.digest("hex")
		.slice(0, 12);
}

export function createRnProjectContext(
	root: string,
	options: {
		manifestPath?: string;
		appIds?: readonly string[];
		devices?: readonly string[];
	} = {},
): RnProjectContext {
	const projectRoot = canonicalProjectRoot(root);
	const projectKey = rnProjectKey(projectRoot);
	return Object.freeze({
		projectRoot,
		projectKey,
		manifestPath: resolve(
			options.manifestPath ??
				join(agentsimsHome(), "projects", projectKey, "rn-source-map.jsonl"),
		),
		appIds: Object.freeze([...(options.appIds ?? [])]),
		devices: Object.freeze([...(options.devices ?? [])]),
	});
}
