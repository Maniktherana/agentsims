import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function buildMetroFixture(directory: string) {
	// Build outside the test loader, as the release build does. Bun 1.3.14 fails
	// the first relative source lookup here; a fresh bundler resolves it.
	const result = spawnSync(
		process.execPath,
		[
			"build",
			join(
				import.meta.dir,
				"../../../../agentsims-react-native/src/node/metro.ts",
			),
			"--target=node",
			"--outfile",
			join(directory, "metro.mjs"),
		],
		{ encoding: "utf8", timeout: 10_000 },
	);
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
}

test.serial.each(["Metro shutdown", "parent exit"])(
	"Node Metro manages a Bun process through %s",
	async (exitMode) => {
		const directory = mkdtempSync(join(tmpdir(), "agentsims-metro-process-"));
		try {
			const machineRuntime = join(directory, "machine install", "agentsims");
			mkdirSync(resolve(machineRuntime, ".."), { recursive: true });
			// A device-free child implements the executable's readiness and stdin contract.
			writeFileSync(
				machineRuntime,
				`#!${process.execPath}
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  appendFileSync("version-checks", "checked\\n");
  console.log("99.4.0");
  process.exit(0);
}
assert.deepEqual(process.argv.slice(2), ["serve", "--port", "0", "--host", "127.0.0.1", "--base-path", "/.sim", "--json", "--managed"]);
assert.equal(process.env.AGENTSIMS_PROJECT_ROOT, process.cwd());
assert.equal(process.env.AGENTSIMS_RN_MANIFEST, process.cwd() + "/manifest.jsonl");
appendFileSync("starts", "started\\n");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
  fetch(request) { return new Response(new URL(request.url).pathname); }
});
console.log(JSON.stringify({ type: "ready", url: "http://127.0.0.1:" + server.port + "/.sim", capabilities: { managedServer: 1, sourceContext: 1 } }));
process.stdin.resume();
process.stdin.once("end", () => { server.stop(true); appendFileSync("stopped", "closed"); process.exit(0); });
`,
				{ mode: 0o755 },
			);
			buildMetroFixture(directory);
			const result = spawnSync(
				"node",
				[
					"--input-type=module",
					"-e",
					`
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { withAgentsims } from "./metro.mjs";
assert.equal(process.versions.bun, undefined);
let handled = 0;
let ended = 0;
const server = { async end() { ended++; } };
const config = withAgentsims({}, {
  preview: true, projectRoot: process.cwd(),
  manifestPath: process.cwd() + "/manifest.jsonl", instrumentBabel: false,
});
const middleware = config.server.enhanceMiddleware(() => handled++, server);
const redirect = (url) => new Promise((resolve, reject) => {
  let status, headers;
  middleware({ url }, {
    writeHead(code, values) { status = code; headers = values; },
    end() { resolve({ status, headers }); },
  }, reject);
});
let url;
try {
  for (const path of ["/index.bundle", "/.similar", "/.sim/socket"]) {
    middleware({ url: path }, {}, () => {});
  }
  assert.equal(handled, 3);
  assert.equal(existsSync("starts"), false, "unrelated requests must not start Agentsims");
  assert.equal(existsSync("version-checks"), false, "unrelated requests must not probe Agentsims");
  const [first, second] = await Promise.all([redirect("/.sim"), redirect("/.sim/")]);
  assert.equal(first.status, 307);
  assert.equal(first.headers["Cache-Control"], "no-store");
  assert.deepEqual(second, first);
  assert.equal(readFileSync("starts", "utf8"), "started\\n");
  assert.equal(readFileSync("version-checks", "utf8"), "checked\\n");
  url = first.headers.Location;
  assert.match(url, /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/\\.sim$/);
  assert.equal(await (await fetch(url)).text(), "/.sim");
  if (${JSON.stringify(exitMode)} === "parent exit") {
    console.log("managed redirect verified");
    process.exit(0); // Bypass Metro's shutdown hook. The OS must close the pipe.
  }
} finally {
  await server.end();
}
assert.equal(ended, 1);
await assert.rejects(fetch(url));
console.log("managed redirect verified");
`,
				],
				{
					cwd: directory,
					encoding: "utf8",
					timeout: 10_000,
					env: { ...process.env, AGENTSIMS_BIN: machineRuntime },
				},
			);
			expect(result.error).toBeUndefined();
			expect(result.stderr).toBe("");
			expect(result.status).toBe(0);
			expect(result.stdout).toContain("managed redirect verified");
			const deadline = Date.now() + 2_000;
			while (!existsSync(join(directory, "stopped")) && Date.now() < deadline) {
				await Bun.sleep(20);
			}
			expect(existsSync(join(directory, "stopped"))).toBe(true);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	},
	15_000,
);

test("Node source-map middleware works with a missing machine runtime", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-metro-source-only-"));
	try {
		buildMetroFixture(directory);
		const result = spawnSync(
			"node",
			[
				"--input-type=module",
				"-e",
				`
import assert from "node:assert/strict";
import { withAgentsims } from "./metro.mjs";
assert.equal(process.versions.bun, undefined);
let ended = 0;
const server = { async end() { ended++; } };
const config = withAgentsims({}, {
  projectRoot: process.cwd(), manifestPath: process.cwd() + "/manifest.jsonl",
  instrumentBabel: false, preview: true,
});
const middleware = config.server.enhanceMiddleware(() => assert.fail("unexpected inner request"), server);
let body;
const res = { setHeader() {}, end(value) { body = JSON.parse(value); } };
middleware({ url: "/_agentsims/source-map" }, res, () => {});
assert.deepEqual(body.entries, []);
assert.equal(body.manifestPath, process.cwd() + "/manifest.jsonl");
await server.end();
assert.equal(ended, 1);
console.log("source-only integration verified");
`,
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 10_000,
				env: {
					...process.env,
					AGENTSIMS_BIN: join(directory, "missing-runtime"),
				},
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("source-only integration verified");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
