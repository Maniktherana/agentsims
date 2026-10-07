import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const entry = join(import.meta.dir, "../../cli/main.ts");

test("the MCP CLI writes no protocol or readiness text before initialization", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-mcp-cli-eof-"));
	try {
		const result = spawnSync(process.execPath, [entry, "mcp"], {
			input: "",
			encoding: "utf8",
			timeout: 10_000,
			env: { ...process.env, AGENTSIMS_HOME_DIR: directory },
		});
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("");
		expect(result.status).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test.each(["SIGINT", "SIGTERM"] as const)(
	"the initialized MCP CLI disposes its owned runtime after %s",
	async (signal) => {
		const directory = mkdtempSync(join(tmpdir(), "agentsims-mcp-cli-signal-"));
		const child = Bun.spawn([process.execPath, entry, "mcp"], {
			stdin: "pipe",
			stdout: "pipe",
			stderr: "pipe",
			env: { ...process.env, AGENTSIMS_HOME_DIR: directory },
		});
		const stderr = new Response(child.stderr).text();
		const reader = child.stdout.getReader();
		const deadline = setTimeout(() => child.kill("SIGKILL"), 10_000);
		try {
			child.stdin.write(
				`${JSON.stringify({
					jsonrpc: "2.0",
					id: 1,
					method: "initialize",
					params: {
						protocolVersion: "2025-11-25",
						capabilities: {},
						clientInfo: { name: "agentsims-cli-fixture", version: "1.0.0" },
					},
				})}\n`,
			);
			await child.stdin.flush();
			const decoder = new TextDecoder();
			let stdout = "";
			while (!stdout.includes("\n")) {
				const part = await reader.read();
				if (part.done)
					throw new Error(`MCP exited before initialization: ${await stderr}`);
				stdout += decoder.decode(part.value, { stream: true });
			}
			const initialized = JSON.parse(stdout.split("\n")[0]!);
			expect(initialized.id).toBe(1);
			expect(initialized.result?.serverInfo.name).toBe("agentsims");
			child.kill(signal);
			expect(await child.exited).toBe(0);
			for (;;) {
				const part = await reader.read();
				stdout += decoder.decode(part.value, { stream: !part.done });
				if (part.done) break;
			}
			expect(await stderr).toBe("");
			// Every stdout line must be protocol JSON. No owned-server readiness log.
			expect(
				stdout
					.trim()
					.split("\n")
					.map((line) => JSON.parse(line).jsonrpc),
			).toEqual(["2.0"]);
		} finally {
			clearTimeout(deadline);
			child.stdin.end();
			if (child.exitCode === null) child.kill("SIGKILL");
			await child.exited;
			await reader.cancel();
			reader.releaseLock();
			rmSync(directory, { recursive: true, force: true });
		}
	},
	15_000,
);
