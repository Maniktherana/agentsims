import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

test("a repeated interrupt waits for server cleanup", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-shutdown-"));
	const child = spawn(
		process.execPath,
		[resolve(import.meta.dir, "../fixtures/cli-shutdown.ts")],
		{
			env: {
				...process.env,
				TMPDIR: directory,
				TMP: directory,
				TEMP: directory,
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	let errors = "";
	let interrupted = false;
	let repeated = false;
	child.stdout.setEncoding("utf8").on("data", (chunk) => {
		output += chunk;
		if (!interrupted && output.includes('"type":"ready"')) {
			interrupted = true;
			child.kill("SIGINT");
		}
		if (!repeated && output.includes("cleanup-started")) {
			repeated = true;
			child.kill("SIGINT");
		}
	});
	child.stderr.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
	const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
	try {
		const result = await new Promise<{
			code: number | null;
			signal: string | null;
		}>((resolveExit, reject) => {
			child.once("error", reject);
			child.once("close", (code, signal) => resolveExit({ code, signal }));
		});
		expect(repeated).toBe(true);
		expect({ ...result, output, errors }).toMatchObject({
			code: 0,
			signal: null,
		});
		expect(output).toContain("cleanup-complete");
		expect(errors).toContain("[server] Stopped.");
	} finally {
		clearTimeout(timeout);
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		rmSync(directory, { recursive: true, force: true });
	}
}, 10_000);
