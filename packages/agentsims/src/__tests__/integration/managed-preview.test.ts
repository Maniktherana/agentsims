import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a managed preview stays local and closes without changing the saved server", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-managed-preview-"));
	try {
		const result = spawnSync(
			process.execPath,
			[
				"--eval",
				`
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { join } from "node:path";
import { startManagedPreview } from ${JSON.stringify(join(import.meta.dir, "../../cli/local-server.ts"))};
const state = join(process.env.AGENTSIMS_HOME_DIR, "state");
mkdirSync(state, { recursive: true });
const record = join(state, "local-server.json");
const original = JSON.stringify({ fixture: "another server" });
writeFileSync(record, original);
const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
const runtime = await startManagedPreview();
try {
  const url = new URL(runtime.origin);
  assert.equal(url.hostname, "127.0.0.1");
  assert(Number(url.port) > 0);
  const capabilities = await (await fetch(runtime.origin + "/capabilities")).json();
  assert.deepEqual(capabilities.runtime, { managedServer: 1, sourceContext: 1, appLogs: 1, context: 1, workspace: 1 });
  assert.equal(readFileSync(record, "utf8"), original);
  assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signals);
} finally {
  await Promise.all([runtime.close(), runtime.close()]);
}
assert.equal(readFileSync(record, "utf8"), original);
// A fresh connection must fail. A pooled keep-alive connection may finish
// against the platform's empty handler after scoped disposal.
await assert.rejects(new Promise((resolve, reject) => {
  get(runtime.origin + "/capabilities", { agent: false }, response => {
    response.resume();
    resolve(response.statusCode);
  }).on("error", reject);
}));
console.log(JSON.stringify({ closed: true }));
`,
			],
			{
				encoding: "utf8",
				timeout: 15_000,
				env: { ...process.env, AGENTSIMS_HOME_DIR: directory },
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		// The startup path must not write readiness text to protocol stdout.
		expect(result.stdout).toBe(`${JSON.stringify({ closed: true })}\n`);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
