/** TCP port ownership helpers for helper lifecycle management. */
import { hostCommandText, hostSleep } from "./host-tools-runtime";

/**
 * Return PIDs currently listening on a TCP port, excluding this process.
 * The LISTEN filter prevents client processes from being terminated.
 */
export async function getPortHolders(port: number): Promise<number[]> {
	try {
		const output = (
			await hostCommandText("lsof", "-ti", `tcp:${port}`, "-sTCP:LISTEN")
		).trim();
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

/** Terminate each process that listens on the specified port. */
export async function killPortHolder(port: number): Promise<void> {
	const processIds = await getPortHolders(port);
	if (processIds.length === 0) return;
	console.log(
		`\x1b[90mPort ${port} busy, killing listener pid(s): ${processIds.join(", ")}\x1b[0m`,
	);
	await Promise.all(
		processIds.map((processId) =>
			hostCommandText("kill", "-9", String(processId)).catch(() => ""),
		),
	);
	await hostSleep(100);
}
