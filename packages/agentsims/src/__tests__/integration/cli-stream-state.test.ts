import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("detached CLI lifecycle publishes status and stops its owned server", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-cli-state-"));
	const cli = resolve(import.meta.dir, "../../cli/main.ts");
	const env = { ...process.env, TMPDIR: directory };
	const run = async (args: string[]) => {
		const child = Bun.spawn([process.execPath, cli, ...args], {
			env,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, status] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, status };
	};
	try {
		const started = await run(["start", "--detach", "--port", "0"]);
		expect(started.stderr).toBe("");
		expect(started.status).toBe(0);
		const record = JSON.parse(started.stdout);
		expect(record.pid).toBeGreaterThan(0);
		expect(record.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

		const status = await run(["status", "--json"]);
		expect(status.status).toBe(0);
		expect(JSON.parse(status.stdout)).toEqual(record);

		const readable = await run(["status"]);
		expect(readable.status).toBe(0);
		expect(readable.stdout).toContain(record.url);
		expect(readable.stdout).not.toContain("{");

		const stopped = await run(["stop"]);
		expect(stopped.status).toBe(0);
		expect(stopped.stdout).toBe("Agentsims stopped.\n");
		expect(JSON.parse((await run(["status", "--json"])).stdout)).toEqual({
			running: false,
		});
		expect((await run(["status"])).stdout).toContain(
			"agentsims start --detach",
		);
	} finally {
		await run(["stop"]);
		rmSync(directory, { recursive: true, force: true });
	}
}, 15000);
