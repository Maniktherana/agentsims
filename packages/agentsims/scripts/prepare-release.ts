import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	CHATGPT_ARCHIVE_NAME,
	CHATGPT_ARTIFACTS,
	HOMEBREW_TARGETS,
	LIBRARY_ARCHIVE_NAME,
	LIBRARY_ARTIFACTS,
	LIBRARY_DECLARATIONS,
	RUNTIME_TARGETS,
	runtimeArchiveName,
	runtimeArchiveTool,
	runtimeArtifacts,
	runtimeExecutableName,
	runtimeTarget,
	type RuntimeTarget,
} from "./release-targets";

export type ReleaseMetadata = {
	schemaVersion: 1;
	version: string;
	repository: string;
	artifacts: Record<RuntimeTarget, { file: string; sha256: string }>;
};

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseReleaseMetadata(input: unknown): ReleaseMetadata {
	if (!record(input) || input.schemaVersion !== 1) {
		throw new Error("The release metadata schema must be version 1.");
	}
	const { version, repository } = validateIdentity(
		input.version,
		input.repository,
	);
	if (!record(input.artifacts))
		throw new Error("The release artifacts are missing.");
	for (const target of Object.keys(input.artifacts)) {
		if (!RUNTIME_TARGETS.includes(target as RuntimeTarget)) {
			throw new Error(`Unsupported release target: ${target}.`);
		}
	}
	const artifacts = {} as ReleaseMetadata["artifacts"];
	for (const target of RUNTIME_TARGETS) {
		const artifact = input.artifacts[target];
		if (!record(artifact))
			throw new Error(`Missing release artifact: ${target}.`);
		if (artifact.file !== runtimeArchiveName(target)) {
			throw new Error(`The release archive name is invalid for ${target}.`);
		}
		if (
			typeof artifact.sha256 !== "string" ||
			!/^[0-9a-f]{64}$/.test(artifact.sha256)
		) {
			throw new Error(`The release checksum is invalid for ${target}.`);
		}
		artifacts[target] = { file: artifact.file, sha256: artifact.sha256 };
	}
	return { schemaVersion: 1, version, repository, artifacts };
}

export function releaseChecksums(input: unknown): string {
	const metadata = parseReleaseMetadata(input);
	return RUNTIME_TARGETS.map(
		(target) =>
			`${metadata.artifacts[target].sha256}  ${metadata.artifacts[target].file}\n`,
	).join("");
}

export function releaseArchiveUrl(
	metadata: ReleaseMetadata,
	target: RuntimeTarget,
): string {
	return `https://github.com/${metadata.repository}/releases/download/v${metadata.version}/${metadata.artifacts[target].file}`;
}

const template = readFileSync(
	new URL("./homebrew/agentsims.rb.template", import.meta.url),
	"utf8",
);

export function generateFormula(input: unknown): string {
	const metadata = parseReleaseMetadata(input);
	let formula = template
		.replaceAll(
			"__AGENTSIMS_HOMEPAGE__",
			`https://github.com/${metadata.repository}`,
		)
		.replaceAll("__AGENTSIMS_VERSION__", metadata.version);
	for (const target of HOMEBREW_TARGETS) {
		const placeholder = target.replaceAll("-", "_").toUpperCase();
		const files = [
			"LICENSE",
			...runtimeArtifacts(target).map(
				(artifact) =>
					`dist/${artifact === "preview" ? "preview/index.html" : artifact}`,
			),
		];
		const requiredFiles = `[\n${files.map((file) => `        ${JSON.stringify(file)},`).join("\n")}\n      ]`;
		formula = formula
			.replaceAll(
				`__AGENTSIMS_${placeholder}_URL__`,
				releaseArchiveUrl(metadata, target),
			)
			.replaceAll(
				`__AGENTSIMS_${placeholder}_SHA256__`,
				metadata.artifacts[target].sha256,
			)
			.replaceAll(`__AGENTSIMS_${placeholder}_FILES__`, requiredFiles);
	}
	if (/__AGENTSIMS_[A-Z0-9_]+__/.test(formula))
		throw new Error("The formula template has an unknown release field.");
	return formula;
}

type TargetMetadata = {
	schemaVersion: 1;
	target: RuntimeTarget;
	version: string;
	repository: string;
	file: string;
	sha256: string;
};

type PortableMetadata = {
	schemaVersion: 1;
	target: "portable";
	version: string;
	repository: string;
	libraryFile: string;
	librarySha256: string;
	pluginFile: string;
	pluginSha256: string;
};

function checksum(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function validateIdentity(
	version: unknown,
	repository: unknown,
): { version: string; repository: string } {
	if (
		typeof version !== "string" ||
		!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)
	)
		throw new Error(
			"The release version must be an exact stable version, such as 1.2.3.",
		);
	if (
		typeof repository !== "string" ||
		!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)
	)
		throw new Error("The release repository must have the form owner/name.");
	return { version, repository };
}

function command(executable: string, args: string[]): string {
	if (executable === "tar") executable = runtimeArchiveTool(process.platform);
	const result = spawnSync(executable, args, {
		encoding: "utf8",
		timeout: 30000,
		maxBuffer: 16 * 1024 * 1024,
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${executable} failed: ${result.stderr.trim() || result.stdout.trim() || result.signal || result.status}`,
		);
	return result.stdout;
}

function extract(archive: string, destination: string): void {
	const names = command("tar", ["-tzf", archive])
		.split(/\r?\n/)
		.filter(Boolean);
	if (
		!names.length ||
		names.some((name) => name.startsWith("/") || name.split("/").includes(".."))
	) {
		throw new Error(`The archive contains invalid paths: ${archive}.`);
	}
	const types = command("tar", ["-tvzf", archive])
		.split(/\r?\n/)
		.filter(Boolean);
	if (types.some((line) => !["d", "-"].includes(line[0])))
		throw new Error(`The archive contains unsupported file types: ${archive}.`);
	mkdirSync(destination, { recursive: true });
	command("tar", ["-xzf", archive, "-C", destination]);
}

function files(directory: string, prefix = ""): string[] {
	return readdirSync(join(directory, prefix)).flatMap((name) => {
		const relative = prefix ? `${prefix}/${name}` : name;
		const stat = lstatSync(join(directory, relative));
		if (stat.isSymbolicLink())
			throw new Error(`The release contains a symlink: ${relative}.`);
		return stat.isDirectory() ? files(directory, relative) : [relative];
	});
}

function requireFile(
	directory: string,
	name: string,
	executable = false,
): void {
	const path = join(directory, name);
	if (
		!existsSync(path) ||
		!statSync(path).isFile() ||
		statSync(path).size === 0
	)
		throw new Error(`The release asset is missing or empty: ${name}.`);
	if (executable && (statSync(path).mode & 0o111) === 0)
		throw new Error(`The release asset is not executable: ${name}.`);
}

function validateRuntime(directory: string, target: RuntimeTarget): void {
	const required = [
		"LICENSE",
		...runtimeArtifacts(target).map(
			(artifact) =>
				`dist/${artifact === "preview" ? "preview/index.html" : artifact}`,
		),
	];
	for (const name of required)
		requireFile(
			directory,
			name,
			(target !== "windows-x64" &&
				name === `dist/${runtimeExecutableName(target)}`) ||
				name.endsWith("-helper") ||
				name.endsWith("-settings"),
		);
	for (const name of files(directory)) {
		if (!required.includes(name) && !name.startsWith("dist/preview/"))
			throw new Error(`Unexpected runtime asset for ${target}: ${name}.`);
	}
}

function validateLibrary(directory: string, version: string): void {
	for (const name of [
		"LICENSE",
		"README.md",
		"package.json",
		...LIBRARY_ARTIFACTS.map((file) => `dist/${file}`),
		...LIBRARY_DECLARATIONS.map((file) => `dist/types/${file}`),
	])
		requireFile(directory, name);
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	);
	if (
		manifest.name !== "agentsims" ||
		manifest.version !== version ||
		manifest.private
	)
		throw new Error(
			"The npm library name or version does not match the release.",
		);
	for (const field of [
		"bin",
		"scripts",
		"optionalDependencies",
		"agentsimsRuntime",
	]) {
		if (manifest[field] !== undefined)
			throw new Error(`The npm library contains runtime metadata: ${field}.`);
	}
	if (
		Object.keys(manifest.dependencies ?? {}).some((name) =>
			name.startsWith("agentsims-runtime-"),
		)
	)
		throw new Error("The npm library depends on an npm runtime package.");
	const allowed = new Set([
		"LICENSE",
		"README.md",
		"package.json",
		...LIBRARY_ARTIFACTS.map((file) => `dist/${file}`),
	]);
	for (const name of files(directory)) {
		if (
			!allowed.has(name) &&
			!(name.startsWith("dist/types/") && name.endsWith(".d.ts"))
		)
			throw new Error(`The npm library contains a runtime file: ${name}.`);
	}
}

function validatePlugin(directory: string, version: string): void {
	for (const name of CHATGPT_ARTIFACTS) requireFile(directory, name);
	const allowed = new Set<string>(CHATGPT_ARTIFACTS);
	for (const name of files(directory)) {
		if (
			!allowed.has(name) &&
			!(name.startsWith("skills/") && name.endsWith(".md"))
		)
			throw new Error(`Unexpected ChatGPT plugin asset: ${name}.`);
	}
	const manifest = JSON.parse(
		readFileSync(join(directory, "plugin.json"), "utf8"),
	);
	const mcp = JSON.parse(readFileSync(join(directory, "mcp.json"), "utf8"));
	const app = JSON.parse(readFileSync(join(directory, "mcp-app.json"), "utf8"));
	if (
		manifest.name !== "agentsims" ||
		manifest.version !== version ||
		manifest.extensions?.["com.openai"]?.onboardingSkill !==
			"./skills/getting-started/SKILL.md"
	)
		throw new Error("The ChatGPT plugin manifest does not match the release.");
	const connection = mcp.mcpServers?.agentsims;
	if (
		connection?.type !== "stdio" ||
		connection.command !== "agentsims" ||
		connection.cwd !== "./" ||
		JSON.stringify(connection.args) !==
			JSON.stringify(["mcp", "--app", "./mcp-app.json"])
	)
		throw new Error("The ChatGPT plugin must reuse the installed runtime.");
	if (
		app.version !== 1 ||
		app.resource?.uri !== "ui://agentsims/workspace.html" ||
		app.resource.html !== "./assets/workspace.html" ||
		app.resource.mimeType !== "text/html;profile=mcp-app" ||
		app.tool?.name !== "workspace_open" ||
		app.tool.meta?.ui?.resourceUri !== app.resource.uri
	)
		throw new Error("The ChatGPT plugin resource is invalid.");
	const htmlPath = join(directory, "assets/workspace.html");
	if (
		statSync(htmlPath).size > 8 * 1024 * 1024 ||
		/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="(?:stylesheet|modulepreload)"/.test(
			readFileSync(htmlPath, "utf8"),
		)
	)
		throw new Error("The ChatGPT plugin HTML must contain its build assets.");
}

export function recordTargetArtifacts(options: {
	target: RuntimeTarget;
	version: string;
	repository: string;
	directory: string;
	buildDirectory?: string;
}): TargetMetadata {
	validateIdentity(options.version, options.repository);
	if (runtimeTarget(process.platform, process.arch) !== options.target)
		throw new Error("The build host does not match the release target.");
	const file = runtimeArchiveName(options.target);
	if (options.buildDirectory) {
		mkdirSync(options.directory, { recursive: true });
		cpSync(
			join(options.buildDirectory, "releases", file),
			join(options.directory, file),
		);
	}
	const temporary = mkdtempSync(join(tmpdir(), "agentsims-target-record-"));
	try {
		const runtime = join(temporary, "runtime");
		extract(join(options.directory, file), runtime);
		validateRuntime(runtime, options.target);
		if (
			command(join(runtime, "dist", runtimeExecutableName(options.target)), [
				"--version",
			]).trim() !== options.version
		)
			throw new Error("The executable version does not match the release.");
		const metadata: TargetMetadata = {
			schemaVersion: 1,
			target: options.target,
			version: options.version,
			repository: options.repository,
			file,
			sha256: checksum(join(options.directory, file)),
		};
		writeFileSync(
			join(options.directory, `${options.target}.json`),
			JSON.stringify(metadata, null, 2) + "\n",
		);
		return metadata;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export function recordPortableArtifacts(options: {
	version: string;
	repository: string;
	directory: string;
	libraryDirectory?: string;
	pluginArchive?: string;
}): PortableMetadata {
	validateIdentity(options.version, options.repository);
	mkdirSync(options.directory, { recursive: true });
	if (options.libraryDirectory)
		command("tar", [
			"-czf",
			join(options.directory, LIBRARY_ARCHIVE_NAME),
			"-C",
			options.libraryDirectory,
			".",
		]);
	if (options.pluginArchive)
		cpSync(
			options.pluginArchive,
			join(options.directory, CHATGPT_ARCHIVE_NAME),
		);
	const temporary = mkdtempSync(join(tmpdir(), "agentsims-portable-record-"));
	try {
		const library = join(temporary, "library");
		const plugin = join(temporary, "plugin");
		extract(join(options.directory, LIBRARY_ARCHIVE_NAME), library);
		extract(join(options.directory, CHATGPT_ARCHIVE_NAME), plugin);
		validateLibrary(library, options.version);
		validatePlugin(plugin, options.version);
		const metadata: PortableMetadata = {
			schemaVersion: 1,
			target: "portable",
			version: options.version,
			repository: options.repository,
			libraryFile: LIBRARY_ARCHIVE_NAME,
			librarySha256: checksum(join(options.directory, LIBRARY_ARCHIVE_NAME)),
			pluginFile: CHATGPT_ARCHIVE_NAME,
			pluginSha256: checksum(join(options.directory, CHATGPT_ARCHIVE_NAME)),
		};
		writeFileSync(
			join(options.directory, "portable.json"),
			JSON.stringify(metadata, null, 2) + "\n",
		);
		return metadata;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

export function prepareRelease(options: {
	version: string;
	repository: string;
	artifactsDirectory: string;
	releaseDirectory: string;
	libraryDirectory: string;
}): ReleaseMetadata {
	validateIdentity(options.version, options.repository);
	if (
		existsSync(options.releaseDirectory) ||
		existsSync(options.libraryDirectory)
	)
		throw new Error(
			"The release and library output directories must not exist.",
		);
	for (const target of readdirSync(options.artifactsDirectory)) {
		if (
			target !== "portable" &&
			!RUNTIME_TARGETS.includes(target as RuntimeTarget)
		)
			throw new Error(`Unexpected release target: ${target}.`);
	}
	const temporary = mkdtempSync(join(tmpdir(), "agentsims-release-prepare-"));
	const metadata = {
		schemaVersion: 1,
		version: options.version,
		repository: options.repository,
		artifacts: {},
	} as ReleaseMetadata;
	try {
		for (const target of RUNTIME_TARGETS) {
			const directory = join(options.artifactsDirectory, target);
			const record: TargetMetadata = JSON.parse(
				readFileSync(join(directory, `${target}.json`), "utf8"),
			);
			if (
				record.schemaVersion !== 1 ||
				record.target !== target ||
				record.version !== options.version ||
				record.repository !== options.repository ||
				record.file !== runtimeArchiveName(target)
			)
				throw new Error(`The artifact metadata does not match ${target}.`);
			if (checksum(join(directory, record.file)) !== record.sha256)
				throw new Error(`The artifact checksum does not match ${target}.`);
			const runtime = join(temporary, target, "runtime");
			extract(join(directory, record.file), runtime);
			validateRuntime(runtime, target);
			metadata.artifacts[target] = { file: record.file, sha256: record.sha256 };
		}
		const portableDirectory = join(options.artifactsDirectory, "portable");
		const portable: PortableMetadata = JSON.parse(
			readFileSync(join(portableDirectory, "portable.json"), "utf8"),
		);
		if (
			portable.schemaVersion !== 1 ||
			portable.target !== "portable" ||
			portable.version !== options.version ||
			portable.repository !== options.repository ||
			portable.libraryFile !== LIBRARY_ARCHIVE_NAME ||
			portable.pluginFile !== CHATGPT_ARCHIVE_NAME
		)
			throw new Error(
				"The portable artifact metadata does not match the release.",
			);
		if (
			checksum(join(portableDirectory, LIBRARY_ARCHIVE_NAME)) !==
			portable.librarySha256
		)
			throw new Error("The npm library checksum does not match the release.");
		if (
			checksum(join(portableDirectory, CHATGPT_ARCHIVE_NAME)) !==
			portable.pluginSha256
		)
			throw new Error(
				"The ChatGPT plugin checksum does not match the release.",
			);
		const library = join(temporary, "library");
		const plugin = join(temporary, "plugin");
		extract(join(portableDirectory, LIBRARY_ARCHIVE_NAME), library);
		extract(join(portableDirectory, CHATGPT_ARCHIVE_NAME), plugin);
		validateLibrary(library, options.version);
		validatePlugin(plugin, options.version);
		const validated = parseReleaseMetadata(metadata);
		const formula = generateFormula(validated);
		const installerTemplate = readFileSync(
			new URL("./install.sh", import.meta.url),
			"utf8",
		);
		if (!installerTemplate.includes("__AGENTSIMS_RELEASE_VERSION__"))
			throw new Error("The installer release version is missing.");
		const installer = installerTemplate
			.replaceAll("__AGENTSIMS_RELEASE_VERSION__", validated.version)
			.replaceAll(
				"https://github.com/Maniktherana/agentsims",
				`https://github.com/${validated.repository}`,
			);
		if (installer.includes("__AGENTSIMS_RELEASE_VERSION__"))
			throw new Error("The installer release version was not set.");
		mkdirSync(options.releaseDirectory, { recursive: true });
		for (const target of RUNTIME_TARGETS)
			cpSync(
				join(options.artifactsDirectory, target, runtimeArchiveName(target)),
				join(options.releaseDirectory, runtimeArchiveName(target)),
			);
		writeFileSync(
			join(options.releaseDirectory, "release-metadata.json"),
			JSON.stringify(validated, null, 2) + "\n",
		);
		const pluginArchive = join(portableDirectory, CHATGPT_ARCHIVE_NAME);
		cpSync(pluginArchive, join(options.releaseDirectory, CHATGPT_ARCHIVE_NAME));
		writeFileSync(
			join(options.releaseDirectory, "SHA256SUMS"),
			releaseChecksums(validated) +
				`${checksum(pluginArchive)}  ${CHATGPT_ARCHIVE_NAME}\n`,
		);
		writeFileSync(join(options.releaseDirectory, "install.sh"), installer);
		writeFileSync(join(options.releaseDirectory, "agentsims.rb"), formula);
		cpSync(library, options.libraryDirectory, { recursive: true });
		return validated;
	} finally {
		rmSync(temporary, { recursive: true, force: true });
	}
}

if (import.meta.main) {
	try {
		const [operation, ...args] = process.argv.slice(2);
		if (
			operation === "record" &&
			(args.length === 4 ||
				(args.length === 6 && args[4] === "--build-directory"))
		) {
			const [target, version, repository, directory, , buildDirectory] = args;
			if (!RUNTIME_TARGETS.includes(target as RuntimeTarget))
				throw new Error(`Unsupported release target: ${target}.`);
			recordTargetArtifacts({
				target: target as RuntimeTarget,
				version,
				repository,
				directory: resolve(directory),
				buildDirectory: buildDirectory ? resolve(buildDirectory) : undefined,
			});
		} else if (operation === "record-portable" && args.length === 5) {
			const [version, repository, directory, libraryDirectory, pluginArchive] =
				args;
			recordPortableArtifacts({
				version,
				repository,
				directory: resolve(directory),
				libraryDirectory: resolve(libraryDirectory),
				pluginArchive: resolve(pluginArchive),
			});
		} else if (operation === "prepare" && args.length === 5) {
			const [
				version,
				repository,
				artifactsDirectory,
				releaseDirectory,
				libraryDirectory,
			] = args;
			prepareRelease({
				version,
				repository,
				artifactsDirectory: resolve(artifactsDirectory),
				releaseDirectory: resolve(releaseDirectory),
				libraryDirectory: resolve(libraryDirectory),
			});
		} else {
			throw new Error(
				"Use record <target> <version> <repository> <artifacts> [--build-directory dist], record-portable <version> <repository> <artifacts> <library> <plugin-archive>, or prepare <version> <repository> <artifacts> <release> <library>.",
			);
		}
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : "Release preparation failed.",
		);
		process.exitCode = 1;
	}
}
