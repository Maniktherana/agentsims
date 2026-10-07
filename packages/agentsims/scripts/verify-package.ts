import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { parseArgs } from "node:util";
import {
	CHATGPT_ARCHIVE_NAME,
	CHATGPT_ARTIFACTS,
	LIBRARY_ARTIFACTS,
	LIBRARY_DECLARATIONS,
	runtimeArchiveName,
	runtimeArtifacts,
	runtimeTarget,
	runtimeExecutableName,
	runtimeArchiveTool,
} from "./release-targets";
import { buildAndroidAccessibility } from "../android/accessibility/build";
import { loadMcpAppConfiguration } from "../src/server/mcp/app-config";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
	options: {
		product: { type: "string", default: "all" },
		library: { type: "string" },
		runtime: { type: "string" },
		plugin: { type: "string" },
	},
});
const product = values.product ?? "all";
if (!["all", "runtime", "library", "plugin"].includes(product))
	throw new Error("Select all, runtime, library, or plugin verification.");
const target = runtimeTarget(process.platform, process.arch);
if (!target && (product === "all" || product === "runtime"))
	throw new Error(
		`No packaged runtime exists for ${process.platform}-${process.arch}.`,
	);
const mainDirectory = resolve(
	values.library ?? join(root, "../agentsims-react-native/dist/npm/agentsims"),
);
const archive = resolve(
	values.runtime ??
		join(
			root,
			"dist/releases",
			target ? runtimeArchiveName(target) : "unsupported",
		),
);
const pluginArchive = resolve(
	values.plugin ?? join(root, "../chatgpt/dist", CHATGPT_ARCHIVE_NAME),
);
const releaseVersion =
	process.env.AGENTSIMS_RELEASE_VERSION ??
	JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const temporary = await mkdtemp(join(tmpdir(), "agentsims-package-smoke-"));
const installDirectory = join(temporary, "library consumer");
const runtimeDirectory = join(temporary, "runtime relocation");
const isolatedTmp = join(temporary, "tmp");
const children = new Set<ChildProcess>();
const environment = {
	...process.env,
	TMPDIR: isolatedTmp,
	TMP: isolatedTmp,
	TEMP: isolatedTmp,
	npm_config_cache: join(temporary, "npm-cache"),
	AGENTSIMS_INSTALL_DIR: join(temporary, "machine install"),
	AGENTSIMS_HOME_DIR: join(temporary, "data"),
};

function run(
	command: string,
	args: string[],
	options: { cwd?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
) {
	if (command === "tar") command = runtimeArchiveTool(process.platform);
	if (command === "npm" && process.platform === "win32") {
		const npm = Bun.which("npm");
		if (!npm)
			throw new Error("npm is required for library package verification.");
		const cli = join(dirname(npm), "node_modules/npm/bin/npm-cli.js");
		if (!existsSync(cli))
			throw new Error(`The npm CLI is missing beside ${npm}.`);
		command = "node";
		args = [cli, ...args];
	}
	return new Promise<{ stdout: string; stderr: string }>(
		(resolveRun, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd ?? root,
				env: options.env ?? environment,
				stdio: ["pipe", "pipe", "pipe"],
			});
			children.add(child);
			let stdout = "",
				stderr = "";
			child
				.stdout!.setEncoding("utf8")
				.on("data", (value) => (stdout += value));
			child
				.stderr!.setEncoding("utf8")
				.on("data", (value) => (stderr += value));
			const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
			child.once("error", reject);
			child.once("close", (code, signal) => {
				clearTimeout(timer);
				children.delete(child);
				if (code === 0) resolveRun({ stdout, stderr });
				else
					reject(
						new Error(
							`${command} ${args.join(" ")} failed (${signal ?? code}).\n${stdout}${stderr}`,
						),
					);
			});
			child.stdin!.end(options.input);
		},
	);
}

async function pack(directory: string): Promise<string> {
	const result = await run("npm", [
		"pack",
		directory,
		"--ignore-scripts",
		"--json",
		"--pack-destination",
		temporary,
	]);
	const output = JSON.parse(result.stdout) as Array<{ filename: string }>;
	if (!output[0]?.filename)
		throw new Error(`npm pack did not return a filename for ${directory}.`);
	return join(temporary, basename(output[0].filename));
}

async function localDependencyArchives(
	dependencies: Record<string, string>,
): Promise<string[]> {
	const visited = new Set<string>();
	const archives: string[] = [];
	async function collect(name: string, from: string): Promise<void> {
		if (visited.has(name)) return;
		visited.add(name);
		const require = createRequire(from);
		let directory: string;
		try {
			directory = dirname(require.resolve(`${name}/package.json`));
		} catch {
			directory = dirname(require.resolve(name));
			while (true) {
				const manifest = join(directory, "package.json");
				if (
					existsSync(manifest) &&
					JSON.parse(readFileSync(manifest, "utf8")).name === name
				)
					break;
				const parent = dirname(directory);
				if (parent === directory)
					throw new Error(`Cannot locate the installed package ${name}.`);
				directory = parent;
			}
		}
		const manifestPath = join(directory, "package.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		archives.push(await pack(directory));
		for (const dependency of Object.keys({
			...manifest.dependencies,
			...manifest.peerDependencies,
		})) {
			if (manifest.peerDependenciesMeta?.[dependency]?.optional) continue;
			await collect(dependency, manifestPath);
		}
	}
	for (const name of Object.keys(dependencies))
		await collect(name, join(root, "package.json"));
	return archives;
}

async function get(url: string): Promise<Response> {
	const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`GET ${url} returned ${response.status}.`);
	return response;
}

async function managedSmoke(executable: string): Promise<void> {
	await new Promise<void>((resolveSmoke, reject) => {
		const child = spawn(
			executable,
			[
				"serve",
				"--managed",
				"--json",
				"--host",
				"127.0.0.1",
				"--port",
				"0",
				"--base-path",
				"/managed-smoke",
			],
			{
				cwd: runtimeDirectory,
				env: environment,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		children.add(child);
		let output = "",
			errors = "",
			ready = false;
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`Managed server timed out.\n${output}${errors}`));
		}, 30_000);
		child.stderr!.setEncoding("utf8").on("data", (value) => (errors += value));
		child.stdout!.setEncoding("utf8").on("data", async (value) => {
			output += value;
			if (ready || !output.includes("\n")) return;
			try {
				const record = JSON.parse(output.slice(0, output.indexOf("\n")));
				if (
					record.type !== "ready" ||
					!record.url ||
					!record.port ||
					record.basePath !== "/managed-smoke" ||
					record.capabilities?.managedServer !== 1 ||
					record.capabilities?.sourceContext !== 1
				) {
					throw new Error(`Invalid managed ready record: ${output}`);
				}
				ready = true;
				await get(`${record.url}/status`);
				const html = await (await get(`${record.url}/`)).text();
				const assets = [
					...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g),
				].map((match) => match[1]!);
				if (assets.length === 0)
					throw new Error("Relocated preview has no entry assets.");
				for (const asset of assets)
					await get(new URL(asset, `${record.url}/`).href);
				child.stdin!.end();
			} catch (error) {
				child.kill("SIGTERM");
				reject(error);
			}
		});
		child.once("error", reject);
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			children.delete(child);
			if (ready && code === 0) resolveSmoke();
			else
				reject(
					new Error(
						`Managed server failed (${signal ?? code}).\n${output}${errors}`,
					),
				);
		});
	});
}

async function pluginSmoke(
	version: string,
	executable?: string,
): Promise<void> {
	const directory = join(temporary, "installed plugin");
	await mkdir(directory);
	await run("tar", ["-xzf", pluginArchive, "-C", directory]);
	for (const name of CHATGPT_ARTIFACTS) {
		if (!(await stat(join(directory, name))).isFile())
			throw new Error(`Missing plugin asset: ${name}.`);
	}
	if (
		existsSync(join(directory, "package.json")) ||
		existsSync(join(directory, "node_modules"))
	)
		throw new Error("The installed plugin contains build dependencies.");
	const manifest = JSON.parse(
		await readFile(join(directory, "plugin.json"), "utf8"),
	);
	if (manifest.version !== version)
		throw new Error("The plugin version does not match the release.");
	const app = await loadMcpAppConfiguration(join(directory, "mcp-app.json"));
	const compressed = [
		...app.resource.text.matchAll(/unpack\("([A-Za-z0-9+/=]+)"\)/g),
	];
	if (compressed.length !== 2)
		throw new Error("The plugin omitted its embedded build assets.");
	const [css, script] = compressed.map((match) =>
		gunzipSync(Buffer.from(match[1]!, "base64")).toString("utf8"),
	);
	if (!css?.trim() || !script?.trim())
		throw new Error("The plugin embedded an empty build asset.");
	await run("node", ["--input-type=module", "--check"], { input: script });
	if (!executable) return;
	const child = spawn(executable, ["mcp", "--app", "./mcp-app.json"], {
		cwd: directory,
		env: environment,
		stdio: ["pipe", "pipe", "pipe"],
	});
	children.add(child);
	let sequence = 0,
		buffered = "",
		errors = "";
	const pending = new Map<
		number,
		{ resolve(value: Record<string, any>): void; reject(error: Error): void }
	>();
	const fail = (error: Error) => {
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	};
	child.stdout!.setEncoding("utf8").on("data", (chunk) => {
		buffered += chunk;
		for (;;) {
			const boundary = buffered.indexOf("\n");
			if (boundary < 0) break;
			const line = buffered.slice(0, boundary);
			buffered = buffered.slice(boundary + 1);
			try {
				const message = JSON.parse(line);
				if (message.jsonrpc !== "2.0")
					throw new Error("The plugin emitted invalid MCP output.");
				const waiting = pending.get(message.id);
				if (!waiting) continue;
				pending.delete(message.id);
				if (message.error)
					waiting.reject(new Error(JSON.stringify(message.error)));
				else waiting.resolve(message.result);
			} catch (error) {
				fail(error instanceof Error ? error : new Error(String(error)));
			}
		}
	});
	child.stderr!.setEncoding("utf8").on("data", (chunk) => {
		errors += chunk;
	});
	child.once("error", fail);
	const closed = new Promise<void>((resolveClosed, reject) =>
		child.once("close", (code, signal) => {
			children.delete(child);
			const error = new Error(
				`Plugin MCP exited (${signal ?? code}).\n${errors}`,
			);
			fail(error);
			if (code === 0 && !buffered) resolveClosed();
			else reject(error);
		}),
	);
	// Retain a handler if a protocol request fails before the exit is awaited.
	void closed.catch(() => {});
	const timer = setTimeout(() => {
		child.kill("SIGKILL");
		fail(new Error("The plugin MCP smoke timed out."));
	}, 30_000);
	const request = (method: string, params?: Record<string, unknown>) =>
		new Promise<Record<string, any>>((resolveRequest, reject) => {
			const id = ++sequence;
			pending.set(id, { resolve: resolveRequest, reject });
			child.stdin!.write(
				JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
			);
		});
	try {
		await request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "package-smoke", version: "1" },
		});
		child.stdin!.write(
			JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) +
				"\n",
		);
		const tools = await request("tools/list");
		const workspace = tools.tools.find(
			(tool: Record<string, any>) => tool.name === app.tool.name,
		);
		if (JSON.stringify(workspace?._meta) !== JSON.stringify(app.tool.meta))
			throw new Error("The plugin tool lost its host metadata.");
		const resource = await request("resources/read", { uri: app.resource.uri });
		if (
			resource.contents[0]?.text !== app.resource.text ||
			resource.contents[0]?.mimeType !== app.resource.mimeType
		)
			throw new Error(
				"The installed plugin resource changed over native stdio.",
			);
		child.stdin!.end();
		await closed;
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await closed.catch(() => {});
		}
		clearTimeout(timer);
	}
}

async function verifyLibrary(): Promise<string> {
	const manifest = JSON.parse(
		await readFile(join(mainDirectory, "package.json"), "utf8"),
	);
	const librarySource = JSON.parse(
		await readFile(
			join(root, "../agentsims-react-native/package.json"),
			"utf8",
		),
	);
	if (
		manifest.bin ||
		manifest.optionalDependencies ||
		manifest.agentsimsRuntime ||
		manifest.scripts
	) {
		throw new Error("The npm library contains CLI installation metadata.");
	}
	if (
		manifest.name !== "agentsims" ||
		manifest.version !== releaseVersion ||
		!manifest.dependencies?.effect ||
		!manifest.dependencies?.["@effect/platform"]
	) {
		throw new Error(
			"The library name or public type dependencies are missing.",
		);
	}
	if (
		JSON.stringify(manifest.exports) !==
			JSON.stringify(librarySource.exports) ||
		JSON.stringify(manifest.dependencies) !==
			JSON.stringify(librarySource.dependencies) ||
		manifest.repository?.directory !== "packages/agentsims-react-native"
	) {
		throw new Error(
			"The npm artifact does not match the React Native package.",
		);
	}
	if (
		Object.keys(manifest.dependencies).some(
			(name) =>
				name.includes("modelcontextprotocol") || name.startsWith("@openai/"),
		)
	) {
		throw new Error("The React Native package contains a ChatGPT dependency.");
	}
	const mainTarball = await pack(mainDirectory);
	const contents = (await run("tar", ["-tzf", mainTarball])).stdout
		.split("\n")
		.filter(Boolean);
	for (const file of contents) {
		const relative = file.replace(/^package\//, "");
		const integration = LIBRARY_ARTIFACTS.some(
			(artifact) => relative === `dist/${artifact}`,
		);
		const declaration =
			/^dist\/types\/.*\.d\.ts$/.test(relative) &&
			!/^dist\/types\/(?:cli|server|core\/(?:android|ios))\//.test(relative);
		if (
			!integration &&
			!declaration &&
			!["LICENSE", "README.md", "package.json"].includes(relative)
		) {
			throw new Error(
				`The npm library contains an unrelated file: ${relative}.`,
			);
		}
	}
	for (const file of [
		...LIBRARY_ARTIFACTS,
		...LIBRARY_DECLARATIONS.map((declaration) => `types/${declaration}`),
	]) {
		if (!contents.includes(`package/dist/${file}`))
			throw new Error(`The npm library omitted ${file}.`);
	}
	const dependencies = await localDependencyArchives(manifest.dependencies);
	await writeFile(
		join(installDirectory, "package.json"),
		JSON.stringify({ private: true, type: "module" }),
	);
	await run(
		"npm",
		[
			"install",
			"--offline",
			"--ignore-scripts",
			"--omit=optional",
			"--no-audit",
			"--no-fund",
			mainTarball,
			...dependencies,
		],
		{ cwd: installDirectory },
	);
	if (existsSync(environment.AGENTSIMS_INSTALL_DIR))
		throw new Error("npm installation created a machine runtime directory.");
	for (const format of ["esm", "cjs"] as const) {
		const imports =
			format === "esm"
				? 'import { createRequire } from "node:module"; import { withAgentsims } from "agentsims/metro"; import { inProcessDeviceState } from "agentsims/state"; const require = createRequire(import.meta.url);'
				: 'const { withAgentsims } = require("agentsims/metro"); const { inProcessDeviceState } = require("agentsims/state");';
		await run(
			"node",
			[
				...(format === "esm" ? ["--input-type=module"] : []),
				"-e",
				`${imports}
const assert = require("node:assert/strict");
assert.equal(typeof withAgentsims, "function");
assert.equal(typeof require("agentsims/babel-plugin"), "function");
assert.equal(require("agentsims/package.json").bin, undefined);
assert.equal(inProcessDeviceState("android:emulator-5554", 1234).port, 1234);
assert.equal(process.versions.bun, undefined);`,
			],
			{ cwd: installDirectory },
		);
	}
	await writeFile(
		join(installDirectory, "consumer.ts"),
		`import { withAgentsims, type AgentsimsMetroOptions } from "agentsims/metro";
import babelPlugin from "agentsims/babel-plugin";
import { inProcessDeviceState, type DeviceState, DeviceStateStore } from "agentsims/state";
const options: AgentsimsMetroOptions = { preview: false, instrumentBabel: false };
withAgentsims({}, options);
const state: DeviceState = inProcessDeviceState("android:emulator-5554", 1234);
void state; void DeviceStateStore; void babelPlugin;`,
	);
	await run(
		"node",
		[
			createRequire(join(root, "package.json")).resolve("typescript/bin/tsc"),
			"--noEmit",
			"--strict",
			"--module",
			"NodeNext",
			"--moduleResolution",
			"NodeNext",
			"--target",
			"ES2022",
			"--lib",
			"ESNext,DOM",
			"consumer.ts",
		],
		{ cwd: installDirectory },
	);

	return manifest.version as string;
}

async function verifyRuntime(version: string): Promise<string> {
	if (!target) throw new Error("This host has no runtime verification target.");
	await run("tar", ["-xzf", archive, "-C", runtimeDirectory]);
	for (const artifact of [
		"LICENSE",
		...runtimeArtifacts(target).map((name) => `dist/${name}`),
		"dist/preview/index.html",
	]) {
		const info = await stat(join(runtimeDirectory, artifact));
		if (info.isFile() && info.size === 0)
			throw new Error(`Empty runtime artifact: ${artifact}.`);
	}
	const executable = join(
		runtimeDirectory,
		"dist",
		runtimeExecutableName(target),
	);
	const reportedVersion = await run(executable, ["--version"]);
	if (reportedVersion.stdout.trim() !== version)
		throw new Error(
			"The runtime and library versions do not match the release.",
		);
	const sourceBundle = await readFile(join(root, "dist/agentsims.js"), "utf8");
	if (sourceBundle.includes(root))
		throw new Error("The CLI bundle contains the build checkout path.");
	const androidJar = join(
		runtimeDirectory,
		"dist/android/agentsims-ax-server.jar",
	);
	const rebuiltJar = join(temporary, "rebuilt-android-helper.jar");
	const packagedDexDirectory = join(temporary, "packaged-dex");
	const rebuiltDexDirectory = join(temporary, "rebuilt-dex");
	await Promise.all([mkdir(packagedDexDirectory), mkdir(rebuiltDexDirectory)]);
	buildAndroidAccessibility(rebuiltJar);
	await Promise.all([
		run("jar", ["xf", androidJar, "classes.dex"], {
			cwd: packagedDexDirectory,
		}),
		run("jar", ["xf", rebuiltJar, "classes.dex"], { cwd: rebuiltDexDirectory }),
	]);
	const [packagedDex, rebuiltDex] = await Promise.all([
		readFile(join(packagedDexDirectory, "classes.dex")),
		readFile(join(rebuiltDexDirectory, "classes.dex")),
	]);
	if (!packagedDex.equals(rebuiltDex))
		throw new Error("The packaged Android helper does not match the source.");
	for (const descriptor of [
		"Ldev/agentsims/ax/Main;",
		"Ldev/agentsims/ax/Main$SnapshotRequest;",
		"Ldev/agentsims/ax/Main$NodeRequest;",
	]) {
		if (!packagedDex.includes(descriptor))
			throw new Error(`Android helper is missing ${descriptor}.`);
	}
	if (process.platform === "darwin") {
		for (const artifact of runtimeArtifacts(target).filter(
			(path) => path !== "preview" && !path.startsWith("android/"),
		)) {
			await run("codesign", [
				"--verify",
				"--strict",
				join(runtimeDirectory, "dist", artifact),
			]);
		}
	}
	let detached = false;
	try {
		const started = JSON.parse(
			(
				await run(executable, [
					"start",
					"--detach",
					"--json",
					"--host",
					"127.0.0.1",
					"--port",
					"0",
					"--base-path",
					"/package-smoke",
				])
			).stdout,
		);
		detached = true;
		if (!started.url || !started.port || started.basePath !== "/package-smoke")
			throw new Error("Invalid detached ready record.");
		await get(`${started.url}/status`);
		const status = JSON.parse(
			(await run(executable, ["status", "--json"])).stdout,
		);
		if (
			!status.pid ||
			status.port !== started.port ||
			status.basePath !== "/package-smoke"
		)
			throw new Error("Detached status does not match the started server.");
	} finally {
		if (detached) await run(executable, ["stop"]);
	}
	await managedSmoke(executable);
	return executable;
}

try {
	await Promise.all([
		mkdir(installDirectory, { recursive: true }),
		mkdir(runtimeDirectory),
		mkdir(isolatedTmp),
	]);
	const version =
		product === "all" || product === "library"
			? await verifyLibrary()
			: releaseVersion;
	const executable =
		product === "all" || product === "runtime"
			? await verifyRuntime(version)
			: undefined;
	if (product === "all" || product === "plugin")
		await pluginSmoke(version, executable);
	process.stdout.write(
		`Package smoke passed for ${product}@${version}${target ? ` on ${target}` : ""}.\n`,
	);
} catch (error) {
	const serverLog = join(
		environment.AGENTSIMS_HOME_DIR,
		"logs/local-server.log",
	);
	if (existsSync(serverLog)) {
		throw new Error(
			`${error instanceof Error ? error.message : String(error)}\n${await readFile(serverLog, "utf8")}`,
		);
	}
	throw error;
} finally {
	for (const child of children) child.kill("SIGTERM");
	await rm(temporary, { recursive: true, force: true });
}
