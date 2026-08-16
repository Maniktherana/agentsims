import { runDebug } from "./logger";

export const debugCli = (formatter: unknown, ...args: unknown[]): void => {
	runDebug("cli", formatter, ...args);
};

export const debugHelper = (formatter: unknown, ...args: unknown[]): void => {
	runDebug("helper", formatter, ...args);
};

export const debugState = (formatter: unknown, ...args: unknown[]): void => {
	runDebug("state", formatter, ...args);
};

export const debugMw = (formatter: unknown, ...args: unknown[]): void => {
	runDebug("mw", formatter, ...args);
};
