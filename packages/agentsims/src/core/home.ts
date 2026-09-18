import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function agentsimsHome(): string {
	return process.env.AGENTSIMS_HOME || join(homedir(), ".agentsims");
}

function directory(name: string): string {
	const path = join(agentsimsHome(), name);
	mkdirSync(path, { recursive: true });
	return path;
}

export const screenshotsDirectory = (): string => directory("screenshots");
export const recordingsDirectory = (): string => directory("recordings");
export const tracesDirectory = (): string => directory("traces");
export const logsDirectory = (): string => directory("logs");
export const stateDirectory = (): string => directory("state");
