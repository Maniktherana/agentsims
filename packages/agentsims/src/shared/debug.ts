import createDebug from "debug";

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
