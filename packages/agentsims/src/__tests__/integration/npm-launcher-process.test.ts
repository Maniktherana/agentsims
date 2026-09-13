import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runtimePackageName, runtimeTarget } from "../../cli-launcher";

const directory = mkdtempSync(join(tmpdir(), "agentsims launcher test "));
const launcherPath = join(directory, "launcher.cjs");
const target = runtimeTarget(process.platform, process.arch);
const runtimeName = target && runtimePackageName(target);
const version = "1.2.3-test.1";

beforeAll(async () => {
	if (!target || !runtimeName) return;
	const result = await Bun.build({
		entrypoints: [resolve(import.meta.dir, "../../cli-launcher.ts")],
		target: "node",
		format: "cjs",
		outdir: join(directory, "dist"),
		naming: "agentsims.cjs",
	});
	if (!result.success) throw new AggregateError(result.logs);
	symlinkSync(join(directory, "dist", "agentsims.cjs"), launcherPath);
	writeFileSync(
		join(directory, "package.json"),
		JSON.stringify({
			version,
			optionalDependencies: { [runtimeName]: version },
			agentsimsRuntime: { targets: { [target]: runtimeName } },
		}),
	);
	const runtimeDirectory = join(directory, "node_modules", runtimeName);
	mkdirSync(join(runtimeDirectory, "dist"), { recursive: true });
	writeFileSync(
		join(runtimeDirectory, "package.json"),
		JSON.stringify({ version }),
	);
	const executable = join(runtimeDirectory, "dist", "agentsims");
	writeFileSync(
		executable,
		`#!/usr/bin/env node
if (process.argv[2] === "signals") {
  process.on("SIGINT", () => process.exit(130));
  process.on("SIGTERM", () => process.exit(143));
  console.log("ready");
  setInterval(() => {}, 1000);
} else {
  console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), value: process.env.AGENTSIMS_LAUNCHER_TEST }));
  process.exitCode = 7;
}
`,
	);
	chmodSync(executable, 0o755);
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe.skipIf(!target)("npm launcher process boundary", () => {
	test("preserves literal arguments, project cwd, environment, and exit status", async () => {
		const args = ["a b", "$(no-command)", "--port", "3298"];
		const child = spawn("node", [launcherPath, ...args], {
			cwd: directory,
			env: { ...process.env, AGENTSIMS_LAUNCHER_TEST: "preserved" },
			stdio: ["ignore", "pipe", "pipe"],
		});
		try {
			const output = new Response(child.stdout).text();
			const code = await new Promise((resolve, reject) => {
				child.once("exit", resolve);
				child.once("error", reject);
			});
			expect(code).toBe(7);
			expect(JSON.parse(await output)).toEqual({
				args,
				cwd: realpathSync(directory),
				value: "preserved",
			});
		} finally {
			child.kill();
		}
	});
	for (const [signal, code] of [
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const) {
		test(`forwards ${signal} and exits when the child stops`, async () => {
			const child = spawn("node", [launcherPath, "signals"], {
				cwd: directory,
				stdio: ["ignore", "pipe", "pipe"],
			});
			try {
				const exited = new Promise((resolve, reject) => {
					child.once("exit", resolve);
					child.once("error", reject);
				});
				await new Promise<void>((resolve, reject) => {
					child.stdout.once("data", () => resolve());
					child.once("error", reject);
				});
				child.kill(signal);
				expect(await exited).toBe(code);
			} finally {
				child.kill();
			}
		});
	}
});
