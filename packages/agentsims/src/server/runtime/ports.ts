import { createServer } from "node:net";
import { Command, CommandExecutor } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
/** TCP port ownership helpers for helper lifecycle management. */
import { captureHostCommand } from "../../core/host";

/**
 * Return PIDs currently listening on a TCP port, excluding this process.
 * The LISTEN filter prevents client processes from being terminated.
 */
export async function getPortHolders(port: number): Promise<number[]> {
	try {
		const result = await Effect.runPromise(
			Effect.flatMap(CommandExecutor.CommandExecutor, (executor) =>
				captureHostCommand(
					executor,
					Command.make("lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN"),
				),
			).pipe(Effect.provide(BunContext.layer)),
		);
		const output = result.stdout.trim();
		// lsof exits 1 without output when no process matches the listener filter.
		if (result.exitCode === 1 && !output && !result.stderr.trim()) return [];
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr.trim() ||
					output ||
					`lsof exited with status ${result.exitCode}`,
			);
		}
		if (!output) return [];
		return output
			.split("\n")
			.map((value) => Number(value))
			.filter(
				(processId) => Number.isInteger(processId) && processId !== process.pid,
			);
	} catch (error) {
		console.warn(
			`[agentsims:server] Could not inspect listener on port ${port}`,
			error,
		);
		return [];
	}
}

/** Briefly bind to a port to determine whether it is available. */
export function isPortFree(port: number): Promise<boolean> {
	const { promise, resolve } = Promise.withResolvers<boolean>();
	const server = createServer();
	server.once("error", () => resolve(false));
	server.once("listening", () => server.close(() => resolve(true)));
	server.listen(port);
	return promise;
}
