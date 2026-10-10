import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LIBRARY_ARTIFACTS } from "../../../scripts/release-targets";

const directory = mkdtempSync(join(tmpdir(), "agentsims library process "));
const packageRoot = join(directory, "node_modules", "agentsims");
const sourceManifest = JSON.parse(
	await Bun.file(
		resolve(import.meta.dir, "../../../../agentsims-react-native/package.json"),
	).text(),
);

beforeAll(async () => {
	mkdirSync(join(packageRoot, "dist"), { recursive: true });
	for (const [entry, output, format] of [
		["../../../../agentsims-react-native/src/node/metro", "metro.js", "esm"],
		["../../../../agentsims-react-native/src/node/metro", "metro.cjs", "cjs"],
		[
			"../../../../agentsims-react-native/src/node/babel-plugin",
			"babel-plugin.cjs",
			"cjs",
		],
		["../../core/tools/devices/state", "state.js", "esm"],
		["../../core/tools/devices/state", "state.cjs", "cjs"],
	] as const) {
		const result = spawnSync(
			process.execPath,
			[
				"build",
				resolve(import.meta.dir, `${entry}.ts`),
				"--target=node",
				`--format=${format}`,
				"--outfile",
				join(packageRoot, "dist", output),
				"--external=effect",
				"--external=@effect/platform",
			],
			{ encoding: "utf8", timeout: 10000 },
		);
		if (result.status !== 0) throw new Error(result.stderr);
	}
	const babelPlugin = join(packageRoot, "dist/babel-plugin.cjs");
	writeFileSync(
		babelPlugin,
		(await Bun.file(babelPlugin).text()) +
			"\nmodule.exports = module.exports.default || module.exports;\n",
	);
	writeFileSync(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: sourceManifest.name,
			version: sourceManifest.version,
			type: sourceManifest.type,
			exports: sourceManifest.exports,
		}),
	);
	const require = createRequire(import.meta.url);
	for (const name of ["effect", "@effect/platform"]) {
		const destination = join(directory, "node_modules", name);
		mkdirSync(dirname(destination), { recursive: true });
		symlinkSync(dirname(require.resolve(`${name}/package.json`)), destination);
	}
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

test.each(["esm", "cjs"])(
	"optional integration imports work under Node as %s without an installed runtime",
	(format) => {
		const imports =
			format === "esm"
				? 'import { createRequire } from "node:module"; import { withAgentsims } from "agentsims/metro"; import { inProcessDeviceState } from "agentsims/state"; const require = createRequire(import.meta.url);'
				: 'const { withAgentsims } = require("agentsims/metro"); const { inProcessDeviceState } = require("agentsims/state");';
		const result = spawnSync(
			"node",
			[
				...(format === "esm" ? ["--input-type=module"] : []),
				"-e",
				`${imports}
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
assert.equal(process.versions.bun, undefined);
assert.equal(typeof require("agentsims/babel-plugin"), "function");
assert.equal(require("agentsims/package.json").bin, undefined);
const state = inProcessDeviceState("android:emulator-5554", 1234, "/project");
assert.equal(state.streamUrl, "http://127.0.0.1:1234/project/helper/android:emulator-5554/stream.avcc");
const config = withAgentsims({}, { instrumentBabel: false, manifestPath: process.cwd() + "/manifest.jsonl" });
let source;
config.server.enhanceMiddleware(() => assert.fail("unexpected middleware request"))({url:"/_agentsims/source-map"}, { setHeader(){}, end(value){source=JSON.parse(value);} }, () => {});
assert.deepEqual(source.entries, []);
assert.equal(existsSync(process.env.AGENTSIMS_INSTALL_DIR), false);
console.log("Node integration passed");`,
			],
			{
				cwd: directory,
				encoding: "utf8",
				timeout: 10000,
				env: {
					...process.env,
					AGENTSIMS_BIN: join(directory, "missing-runtime"),
					AGENTSIMS_INSTALL_DIR: join(directory, "install"),
					AGENTSIMS_HOME_DIR: join(directory, "data"),
				},
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout.trim()).toBe("Node integration passed");
	},
);

test("the source package exposes only integration files for npm packing", () => {
	expect(sourceManifest.bin).toBeUndefined();
	for (const artifact of LIBRARY_ARTIFACTS) {
		expect(sourceManifest.files).toContain(`dist/${artifact}`);
	}
	expect(sourceManifest.files).not.toContain("dist/install.sh");
	expect(sourceManifest.files).not.toContain("dist/agentsims.cjs");
});
