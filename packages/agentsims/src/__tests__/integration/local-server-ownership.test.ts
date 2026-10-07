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

test("Linux stop recognizes exited zombies but preserves running or unreadable process ownership", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-linux-owned-stop-"));
	try {
		const source = resolve(import.meta.dir, "../../cli/local-server.ts");
		const script = join(directory, "linux-ownership.ts");
		writeFileSync(
			script,
			`
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";
const read = fs.readFileSync;
let state = "R", unreadable = false, malformed = false, signals = 0;
const pid = 34567;
mock.module("node:fs", () => ({ ...fs, readFileSync: (path, ...args) => {
  if (path === "/proc/" + pid + "/stat") {
    if (unreadable) throw Object.assign(new Error("denied"), { code: "EACCES" });
    return malformed ? "not a proc stat record" : pid + " (server name ) with (parens)) " + state + " 1 0 0";
  }
  return read(path, ...args);
} }));
Object.defineProperty(process, "platform", { value: "linux" });
process.kill = (target, signal) => {
  assert.equal(target, pid);
  if (signal === "SIGTERM") { signals++; state = "Z"; }
  else assert.equal(signal, 0);
  return true;
};
const { readLocalServer, stopLocalServer } = await import(${JSON.stringify(source)});
const { STATE_DIR } = await import(${JSON.stringify(resolve(import.meta.dir, "../../core/tools/devices/state.ts"))});
const metadata = join(STATE_DIR, "local-server.json");
fs.mkdirSync(STATE_DIR, { recursive: true });
const save = () => fs.writeFileSync(metadata, JSON.stringify({ pid, uid: process.getuid(), host: "127.0.0.1", port: 12345, basePath: "/", url: "http://127.0.0.1:12345", logFile: "fixture.log", startedAt: "2026-10-07T00:00:00Z" }));
save();
assert.equal(readLocalServer().pid, pid);
unreadable = true;
assert.equal(readLocalServer().pid, pid);
unreadable = false; malformed = true;
assert.equal(readLocalServer().pid, pid);
malformed = false;
globalThis.fetch = async () => Response.json({ pid });
assert.equal(await stopLocalServer(), true);
assert.equal(signals, 1);
assert.equal(fs.existsSync(metadata), false);
for (const exited of ["Z", "X"]) {
  state = exited; save();
  assert.equal(readLocalServer(), null);
  assert.equal(fs.existsSync(metadata), false);
}
assert.equal(signals, 1);
console.log("Linux exited process ownership verified");
`,
		);
		const result = spawnSync(process.execPath, [script], {
			encoding: "utf8",
			timeout: 10_000,
			env: {
				...process.env,
				AGENTSIMS_HOME_DIR: join(directory, "home"),
				AGENTSIMS_INSTALL_DIR: join(directory, "installation"),
			},
		});
		expect({
			error: result.error,
			stderr: result.stderr,
			status: result.status,
		}).toMatchObject({ error: undefined, stderr: "", status: 0 });
		expect(result.stdout).toContain("Linux exited process ownership verified");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("owned stop verifies PID while normal status waits for device discovery", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-status-identity-"));
	try {
		const script = join(directory, "identity.ts");
		const source = resolve(import.meta.dir, "../..");
		writeFileSync(script, `
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { startTestServer } from ${JSON.stringify(join(source, "__tests__/helpers/server.ts"))};
import { stopLocalServer } from ${JSON.stringify(join(source, "cli/local-server.ts"))};
import { STATE_DIR } from ${JSON.stringify(join(source, "core/tools/devices/state.ts"))};
const { Effect } = await import(${JSON.stringify(resolve(source, "../node_modules/effect/dist/esm/index.js"))});
const discovery = Promise.withResolvers(), entered = Promise.withResolvers();
let reads = 0;
const { origin, server } = await startTestServer({ basePath: "/owned",
  deviceCommands: { workspaces: () => Effect.promise(() => { reads++; entered.resolve(); return discovery.promise; }) } });
const status = fetch(origin + "/owned/status");
await entered.promise;
const identity = await fetch(origin + "/owned/status?identity=1", { signal: AbortSignal.timeout(2000) });
assert.equal(identity.status, 200);
assert.deepEqual(await identity.json(), { pid: process.pid });
assert.equal(reads, 1);
mkdirSync(STATE_DIR, { recursive: true });
const metadata = join(STATE_DIR, "local-server.json");
writeFileSync(metadata, JSON.stringify({ pid: process.pid,
  uid: typeof process.getuid === "function" ? process.getuid() : null,
  host: "127.0.0.1", port: server.port, basePath: "/owned", url: origin + "/owned",
  logFile: "fixture.log", startedAt: "2026-10-07T00:00:00.000Z" }), { mode: 0o600 });
let stopped = false, signals = 0;
const originalKill = process.kill;
Object.defineProperty(process, "platform", { value: "darwin" });
// Keep actual HTTP routing; replace the signal seam to protect this fixture.
process.kill = (pid, signal) => {
  assert.equal(pid, process.pid);
  if (signal === "SIGTERM") {
    signals++;
    assert.equal(reads, 1);
    discovery.resolve([]);
    void server.stop().then(() => { stopped = true; });
  } else if (stopped) throw Object.assign(new Error("gone"), { code: "ESRCH" });
  return true;
};
try {
  assert.equal(await stopLocalServer(), true);
  assert.equal(signals, 1);
  assert.equal(stopped, true, "stop waits for server scope disposal");
  assert.equal(existsSync(metadata), false);
} finally { process.kill = originalKill; discovery.resolve([]); await server.stop(); }
await status.catch(() => {});
const normal = await startTestServer({ deviceCommands: { workspaces: () => Effect.succeed([]) } });
try {
  const response = await fetch(normal.origin + "/status");
  assert.deepEqual(await response.json(), { pid: process.pid, workspaces: [] });
} finally { await normal.server.stop(); }
console.log("identity bypasses pending discovery and owned cleanup completes");
`);
		const result = spawnSync(process.execPath, [script], {
			encoding: "utf8", timeout: 10_000,
			env: { ...process.env, AGENTSIMS_HOME_DIR: join(directory, "home"), AGENTSIMS_INSTALL_DIR: join(directory, "installation") },
		});
		expect(result.error).toBeUndefined();
		expect(result).toMatchObject({ status: 0, stderr: "" });
		expect(result.stdout).toContain("identity bypasses pending discovery and owned cleanup completes");
	} finally { rmSync(directory, { recursive: true, force: true }); }
});
