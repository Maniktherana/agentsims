import createDebug from "debug";

/** Lifecycle events go to stderr; stdout remains usable for CLI JSON. */
export function logRuntime(scope: string, message: string): void {
	process.stderr.write(`${new Date().toISOString()} [${scope}] ${message}\n`);
}

const cli = createDebug("agentsims:cli");
const helper = createDebug("agentsims:helper");
const state = createDebug("agentsims:state");
const middleware = createDebug("agentsims:mw");

export const debugCli = (formatter: unknown, ...args: unknown[]): void => {
	cli(formatter, ...args);
};

export const debugHelper = (formatter: unknown, ...args: unknown[]): void => {
	helper(formatter, ...args);
};

export const debugState = (formatter: unknown, ...args: unknown[]): void => {
	state(formatter, ...args);
};

export const debugMw = (formatter: unknown, ...args: unknown[]): void => {
	middleware(formatter, ...args);
};

export function describeError(error: unknown): string {
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		const name =
			"name" in error && typeof error.name === "string" && error.name !== "Error"
				? error.name
				: null;
		return name && !error.message.startsWith(name)
			? `${name}: ${error.message}`
			: error.message;
	}
	return String(error);
}
