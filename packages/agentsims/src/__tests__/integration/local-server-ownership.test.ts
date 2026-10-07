import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Windows stop validates private ownership and HTTP PID without leaking or killing", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-owned-stop-process-"));
	try {
		const script = join(directory, "ownership.ts");
		const source = resolve(import.meta.dir, "../../cli");
		writeFileSync(script, `
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";
import * as protocol from ${JSON.stringify(join(source, "owned-stop.ts"))};
let requests = 0;
let stopped = false;
const pid = 81234;
const owner = protocol.windowsOwnedStopIdentity(pid);
mock.module(${JSON.stringify(join(source, "owned-stop.ts"))}, () => ({
  ...protocol,
  requestOwnedStop: async options => {
    assert.deepEqual(options, { identity: owner, pid });
    requests++;
    stopped = true;
  },
}));
const { readLocalServer, stopLocalServer } = await import(${JSON.stringify(join(source, "local-server.ts"))});
const { STATE_DIR } = await import(${JSON.stringify(resolve(source, "../core/tools/devices/state.ts"))});
Object.defineProperty(process, "platform", { value: "win32" });
process.kill = (target, signal) => {
  assert.equal(signal, 0, "Windows shutdown must not send a process-kill signal");
  if (target === pid && stopped) throw Object.assign(new Error("gone"), { code: "ESRCH" });
  return true;
};
const metadata = join(STATE_DIR, "local-server.json");
const record = { pid, uid: typeof process.getuid === "function" ? process.getuid() : null,
  host: "127.0.0.1", port: 12345, basePath: "/", url: "http://127.0.0.1:12345",
  logFile: "fixture.log", startedAt: "2026-10-05T00:00:00.000Z", ownedStop: owner };
mkdirSync(STATE_DIR, { recursive: true });
const save = value => writeFileSync(metadata, JSON.stringify(value), { mode: 0o600 });
save(record);
const publicRecord = readLocalServer();
assert.equal(publicRecord.pid, pid);
assert.equal("ownedStop" in publicRecord, false);
assert.equal(JSON.stringify(publicRecord).includes(owner.token), false);
let statusPid = pid + 1;
globalThis.fetch = async () => Response.json({ pid: statusPid });
await assert.rejects(stopLocalServer(), /no longer identifies/);
assert.equal(requests, 0);
statusPid = pid;
save({ ...record, ownedStop: undefined });
await assert.rejects(stopLocalServer(), /no valid owned stop channel/);
assert.equal(requests, 0);
save({ ...record, ownedStop: { ...owner, endpoint: owner.endpoint.replace(String(pid), String(pid + 1)) } });
await assert.rejects(stopLocalServer(), /no valid owned stop channel/);
assert.equal(requests, 0);
save(record);
assert.equal(await stopLocalServer(), true);
assert.equal(requests, 1);
assert.equal(existsSync(metadata), false);
assert.equal(await stopLocalServer(), false);
console.log("private ownership and PID verified");
`);
		const result = spawnSync(process.execPath, [script], {
			encoding: "utf8", timeout: 10_000,
			env: { ...process.env, AGENTSIMS_HOME_DIR: join(directory, "home"), AGENTSIMS_INSTALL_DIR: join(directory, "installation") },
		});
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("private ownership and PID verified");
	} finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI log follow needs no tail command and removes its cancellation handlers", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-log-follow-process-"));
	try {
		const script = join(directory, "follow.ts");
		const source = resolve(import.meta.dir, "../../cli");
		writeFileSync(script, `
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createProgram } from ${JSON.stringify(join(source, "main.ts"))};
import { localServerLogFile } from ${JSON.stringify(join(source, "local-server.ts"))};
mkdirSync(dirname(localServerLogFile), { recursive: true });
const lines = Array.from({ length: 12 }, (_, index) => "line " + (index + 1) + "\\n");
writeFileSync(localServerLogFile, lines.join(""));
const signals = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
let output = "";
process.stdout.write = (text) => {
  output += String(text);
  if (output.endsWith("line 12\\n")) queueMicrotask(() => process.emit("SIGINT"));
  return true;
};
await createProgram().parseAsync(["logs", "--follow"], { from: "user" });
assert.equal(output, lines.slice(2).join(""));
assert.deepEqual([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")], signals);
`);
		const result = spawnSync(process.execPath, [script], {
			encoding: "utf8", timeout: 10_000,
			env: { ...process.env, PATH: "", AGENTSIMS_HOME_DIR: join(directory, "home"), AGENTSIMS_INSTALL_DIR: join(directory, "installation") },
		});
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
