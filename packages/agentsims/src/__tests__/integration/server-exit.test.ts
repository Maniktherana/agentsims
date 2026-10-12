import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Ctrl+C exits the server while a browser keeps an event stream open", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-exit-"));
	const child = spawn(
		process.execPath,
		[
			resolve(import.meta.dir, "../../cli/main.ts"),
			"serve",
			"--json",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
		],
		{
			env: { ...process.env, AGENTSIMS_HOME_DIR: directory },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	let errors = "";
	child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
	child.stderr.setEncoding("utf8").on("data", (chunk) => (errors += chunk));
	const exited = new Promise<number | null>((resolveExit) =>
		child.once("close", (code) => resolveExit(code)),
	);
	const events = new AbortController();
	try {
		while (!output.includes('"type":"ready"')) await Bun.sleep(50);
		const port = Number(/"port":(\d+)/.exec(output)?.[1]);
		// An open tab holds this stream for as long as the page is open.
		const response = await fetch(`http://127.0.0.1:${port}/api/events`, {
			signal: events.signal,
		});
		await response.body!.getReader().read();
		child.kill("SIGINT");
		const code = await Promise.race([exited, Bun.sleep(5_000).then(() => "hung")]);
		expect({ code, errors }).toMatchObject({ code: 0 });
		expect(errors).toContain("[server] Stopped.");
		expect(errors).not.toContain("InterruptedException");
	} finally {
		events.abort();
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
		rmSync(directory, { recursive: true, force: true });
	}
}, 20_000);
