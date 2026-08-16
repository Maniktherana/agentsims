import createDebug, { type Debugger } from "debug";
import { Context, Effect, Layer, ManagedRuntime } from "effect";

export type LogNamespace = "cli" | "helper" | "state" | "mw";

export type AgentLoggerService = {
	log(namespace: LogNamespace, formatter: unknown, ...args: unknown[]): void;
};

export class AgentLogger extends Context.Tag("@agentsims/AgentLogger")<
	AgentLogger,
	AgentLoggerService
>() {}

function liveLogger(): AgentLoggerService {
	const loggers: Record<LogNamespace, Debugger> = {
		cli: createDebug("agentsims:cli"),
		helper: createDebug("agentsims:helper"),
		state: createDebug("agentsims:state"),
		mw: createDebug("agentsims:mw"),
	};
	return {
		log(namespace, formatter, ...args) {
			loggers[namespace](formatter, ...args);
		},
	};
}

export const AgentLoggerLive = Layer.succeed(AgentLogger, liveLogger());

export function logDebug(
	namespace: LogNamespace,
	formatter: unknown,
	...args: unknown[]
): Effect.Effect<void, never, AgentLogger> {
	return Effect.flatMap(AgentLogger, (logger) =>
		Effect.sync(() => logger.log(namespace, formatter, ...args)),
	);
}

const liveRuntime = ManagedRuntime.make(AgentLoggerLive);

export function runDebug(
	namespace: LogNamespace,
	formatter: unknown,
	...args: unknown[]
): void {
	liveRuntime.runSync(logDebug(namespace, formatter, ...args));
}
