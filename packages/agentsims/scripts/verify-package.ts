import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { runtimePackageName, runtimeTarget } from "./release-targets";

const root = resolve(import.meta.dirname, "..");
const packages = resolve(process.argv[2] ?? join(root, "dist/npm"));
const target = runtimeTarget(process.platform, process.arch);
if (!target)
	throw new Error(
		`No packaged runtime exists for ${process.platform}-${process.arch}.`,
	);

const mainDirectory = join(packages, "agentsims");
const runtimeDirectory = join(packages, runtimePackageName(target));
const temporary = await mkdtemp(join(tmpdir(), "agentsims-package-smoke-"));
const installDirectory = join(temporary, "install");
const isolatedTmp = join(temporary, "tmp");
const children = new Set<ChildProcess>();
const environment = {
	...process.env,
	TMPDIR: isolatedTmp,
	TMP: isolatedTmp,
	TEMP: isolatedTmp,
};

function run(
	command: string,
	args: string[],
	options: { cwd?: string; input?: string } = {},
) {
	return new Promise<{ stdout: string; stderr: string }>(
		(resolveRun, reject) => {
			const child = spawn(command, args, {
				cwd: options.cwd ?? root,
				env: environment,
				stdio: ["pipe", "pipe", "pipe"],
			});
			children.add(child);
			let stdout = "";
			let stderr = "";
			child
				.stdout!.setEncoding("utf8")
				.on("data", (value) => (stdout += value));
			child
				.stderr!.setEncoding("utf8")
				.on("data", (value) => (stderr += value));
			const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
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
		"--json",
		"--pack-destination",
		temporary,
	]);
	const output = JSON.parse(result.stdout) as Array<{ filename: string }>;
	if (!output[0]?.filename)
		throw new Error(`npm pack did not return a filename for ${directory}.`);
	return join(temporary, basename(output[0].filename));
}

async function npmExec(...args: string[]) {
	return run("npm", ["exec", "--", "agentsims", ...args], {
		cwd: installDirectory,
	});
}

async function get(url: string): Promise<void> {
	const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) throw new Error(`GET ${url} returned ${response.status}.`);
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
				env: environment,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		children.add(child);
		let output = "";
		let errors = "";
		let ready = false;
		const timer = setTimeout(
			() => reject(new Error(`Managed server timed out.\n${output}${errors}`)),
			30_000,
		);
		child.stderr!.setEncoding("utf8").on("data", (value) => (errors += value));
		child.stdout!.setEncoding("utf8").on("data", async (value) => {
			output += value;
			if (ready || !output.includes("\n")) return;
			try {
				const record = JSON.parse(output.slice(0, output.indexOf("\n"))) as {
					type?: string;
					url?: string;
					port?: number;
					basePath?: string;
				};
				if (
					record.type !== "ready" ||
					!record.url ||
					!record.port ||
					record.basePath !== "/managed-smoke"
				)
					throw new Error(`Invalid managed ready record: ${output}`);
				ready = true;
				await get(`${record.url}/status`);
				child.stdin!.end();
			} catch (error) {
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

try {
	const sourceBundle = await readFile(join(root, "dist/agentsims.js"), "utf8");
	if (sourceBundle.includes(root))
		throw new Error("The CLI bundle contains the build checkout path.");
	await Promise.all([
		mkdir(installDirectory, { recursive: true }),
		mkdir(isolatedTmp, { recursive: true }),
	]);
	const [mainTarball, runtimeTarball] = await Promise.all([
		pack(mainDirectory),
		pack(runtimeDirectory),
	]);
	const androidJar = join(
		runtimeDirectory,
		"dist/android/agentsims-ax-server.jar",
	);
	const rebuiltJar = join(temporary, "rebuilt-android-helper.jar");
	const packagedDexDirectory = join(temporary, "packaged-dex");
	const rebuiltDexDirectory = join(temporary, "rebuilt-dex");
	await Promise.all([
		mkdir(packagedDexDirectory),
		mkdir(rebuiltDexDirectory),
		run("bash", ["android/accessibility/build.sh", rebuiltJar]),
	]);
	await Promise.all([
		run("unzip", [
			"-qq",
			androidJar,
			"classes.dex",
			"-d",
			packagedDexDirectory,
		]),
		run("unzip", ["-qq", rebuiltJar, "classes.dex", "-d", rebuiltDexDirectory]),
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
	await run("npm", ["init", "-y"], { cwd: installDirectory });
	await run(
		"npm",
		[
			"install",
			"--ignore-scripts",
			"--no-audit",
			"--no-fund",
			mainTarball,
			runtimeTarball,
		],
		{ cwd: installDirectory },
	);
	const manifest = JSON.parse(
		await readFile(join(mainDirectory, "package.json"), "utf8"),
	) as { version: string };
	const version = await npmExec("--version");
	if (version.stdout.trim() !== manifest.version)
		throw new Error(
			`Expected version ${manifest.version}, received ${version.stdout.trim()}.`,
		);
	const help = await npmExec("--help");
	if (!help.stdout.includes("start") || !help.stdout.includes("status"))
		throw new Error("Packaged CLI help is incomplete.");
	if (/^\s+setup(?:\s|\[)/m.test(help.stdout))
		throw new Error("Packaged CLI still includes the removed setup command.");
	let detached = false;
	try {
		const started = await npmExec(
			"start",
			"--detach",
			"--json",
			"--host",
			"127.0.0.1",
			"--port",
			"0",
			"--base-path",
			"/package-smoke",
		);
		detached = true;
		const record = JSON.parse(started.stdout) as {
			url?: string;
			port?: number;
			basePath?: string;
		};
		if (!record.url || !record.port || record.basePath !== "/package-smoke")
			throw new Error(`Invalid detached ready record: ${started.stdout}`);
		await get(`${record.url}/status`);
		const status = JSON.parse((await npmExec("status", "--json")).stdout) as {
			pid?: number;
			port?: number;
			basePath?: string;
		};
		if (
			!status.pid ||
			status.port !== record.port ||
			status.basePath !== "/package-smoke"
		)
			throw new Error("Detached status did not match the started server.");
	} finally {
		if (detached) await npmExec("stop");
	}
	await managedSmoke(
		join(
			installDirectory,
			"node_modules",
			runtimePackageName(target),
			"dist",
			"agentsims",
		),
	);
	process.stdout.write(
		`Package smoke passed for agentsims@${manifest.version} on ${target}.\n`,
	);
} finally {
	for (const child of children) child.kill("SIGTERM");
	await rm(temporary, { recursive: true, force: true });
}
