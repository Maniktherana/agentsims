import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	prepareRelease,
	recordPortableArtifacts,
	recordTargetArtifacts,
} from "../../../scripts/prepare-release";
import {
	CHATGPT_ARCHIVE_NAME,
	CHATGPT_ARTIFACTS,
	HOMEBREW_TARGETS,
	LIBRARY_ARCHIVE_NAME,
	LIBRARY_ARTIFACTS,
	LIBRARY_DECLARATIONS,
	RUNTIME_TARGETS,
	runtimeArchiveName,
	runtimeArtifacts,
	runtimeExecutableName,
	runtimeTarget,
	type RuntimeTarget,
} from "../../../scripts/release-targets";

const version = "1.2.3";
const repository = "fixture/agentsims";
let directory: string;
let artifacts: string;
let release: string;
let library: string;

function checksum(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function write(path: string, content = "fixture\n", mode = 0o644): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content, { mode });
}

function source(target: RuntimeTarget, kind: "runtime" | "library"): string {
	return join(
		directory,
		"sources",
		kind === "library" ? "portable" : target,
		kind,
	);
}

function archive(target: RuntimeTarget, kind: "runtime" | "library"): string {
	return join(
		artifacts,
		kind === "runtime" ? target : "portable",
		kind === "runtime" ? runtimeArchiveName(target) : LIBRARY_ARCHIVE_NAME,
	);
}

function recordPath(target: RuntimeTarget): string {
	return join(artifacts, target, `${target}.json`);
}

function pack(target: RuntimeTarget, kind: "runtime" | "library"): void {
	const result = spawnSync(
		"tar",
		["-czf", archive(target, kind), "-C", source(target, kind), "."],
		{ encoding: "utf8" },
	);
	if (result.status !== 0)
		throw new Error(result.stderr || "Fixture archive creation failed.");
}

function packPlugin(): void {
	const result = spawnSync(
		"tar",
		[
			"-czf",
			join(artifacts, "portable", CHATGPT_ARCHIVE_NAME),
			"-C",
			join(directory, "sources/plugin"),
			".",
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0)
		throw new Error(result.stderr || "Plugin archive creation failed.");
}

function record(target: RuntimeTarget): void {
	write(
		recordPath(target),
		JSON.stringify({
			schemaVersion: 1,
			target,
			version,
			repository,
			file: runtimeArchiveName(target),
			sha256: checksum(archive(target, "runtime")),
		}),
	);
}

function recordPortable(): void {
	write(
		join(artifacts, "portable/portable.json"),
		JSON.stringify({
			schemaVersion: 1,
			target: "portable",
			version,
			repository,
			libraryFile: LIBRARY_ARCHIVE_NAME,
			librarySha256: checksum(archive("linux-x64", "library")),
			pluginFile: CHATGPT_ARCHIVE_NAME,
			pluginSha256: checksum(join(artifacts, "portable", CHATGPT_ARCHIVE_NAME)),
		}),
	);
}

function prepare() {
	return prepareRelease({
		version,
		repository,
		artifactsDirectory: artifacts,
		releaseDirectory: release,
		libraryDirectory: library,
	});
}

function rejectBeforeOutput(message?: string): void {
	if (message) expect(prepare).toThrow(message);
	else expect(prepare).toThrow();
	expect(existsSync(release)).toBe(false);
	expect(existsSync(library)).toBe(false);
}

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "agentsims release artifacts "));
	artifacts = join(directory, "artifacts");
	release = join(directory, "release");
	library = join(directory, "npm library");
	const plugin = join(directory, "sources/plugin");
	const pluginSource = resolve(
		import.meta.dir,
		"../../../../../packages/chatgpt",
	);
	for (const name of CHATGPT_ARTIFACTS) {
		if (name === "assets/workspace.html" || name === "LICENSE")
			write(
				join(plugin, name),
				name.endsWith(".html")
					? "<!doctype html><html><body><script type=module>globalThis.fixture=true</script></body></html>"
					: "fixture license",
			);
		else
			write(join(plugin, name), readFileSync(join(pluginSource, name), "utf8"));
	}
	const pluginManifest = JSON.parse(
		readFileSync(join(plugin, "plugin.json"), "utf8"),
	);
	write(
		join(plugin, "plugin.json"),
		JSON.stringify({ ...pluginManifest, version }),
	);
	mkdirSync(join(artifacts, "portable"), { recursive: true });
	packPlugin();
	for (const target of RUNTIME_TARGETS) {
		mkdirSync(join(artifacts, target), { recursive: true });
		write(join(source(target, "runtime"), "LICENSE"));
		for (const asset of runtimeArtifacts(target)) {
			const name = `dist/${asset === "preview" ? "preview/index.html" : asset}`;
			write(
				join(source(target, "runtime"), name),
				asset === "agentsims"
					? `#!/bin/sh\nprintf '${version}\\n'\n`
					: "fixture\n",
				0o755,
			);
		}
		write(join(source(target, "runtime"), "dist/preview/assets/workspace.js"));
		pack(target, "runtime");
		record(target);
	}
	write(join(source("linux-x64", "library"), "LICENSE"));
	write(join(source("linux-x64", "library"), "README.md"));
	write(
		join(source("linux-x64", "library"), "package.json"),
		JSON.stringify({ name: "agentsims", version, type: "module" }),
	);
	for (const asset of LIBRARY_ARTIFACTS)
		write(join(source("linux-x64", "library"), "dist", asset));
	for (const asset of LIBRARY_DECLARATIONS)
		write(join(source("linux-x64", "library"), "dist/types", asset));
	write(
		join(source("linux-x64", "library"), "dist/types/project-context.d.ts"),
	);
	pack("linux-x64", "library");
	recordPortable();
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("complete artifacts produce one consistent release and one library package", () => {
	const metadata = prepare();
	expect(metadata.version).toBe(version);
	expect(metadata.repository).toBe(repository);
	expect(readdirSync(release).sort()).toEqual(
		[
			...RUNTIME_TARGETS.map(runtimeArchiveName),
			CHATGPT_ARCHIVE_NAME,
			"SHA256SUMS",
			"agentsims.rb",
			"install.sh",
			"release-metadata.json",
		].sort(),
	);
	expect(
		JSON.parse(readFileSync(join(release, "release-metadata.json"), "utf8")),
	).toEqual(metadata);
	const lines = readFileSync(join(release, "SHA256SUMS"), "utf8")
		.trim()
		.split("\n");
	for (const [index, target] of RUNTIME_TARGETS.entries()) {
		const hash = checksum(join(release, runtimeArchiveName(target)));
		expect(metadata.artifacts[target].sha256).toBe(hash);
		expect(lines[index]).toBe(`${hash}  ${runtimeArchiveName(target)}`);
	}
	expect(lines.at(-1)).toBe(
		`${checksum(join(release, CHATGPT_ARCHIVE_NAME))}  ${CHATGPT_ARCHIVE_NAME}`,
	);
	const installer = join(release, "install.sh");
	expect(spawnSync("bash", ["-n", installer]).status).toBe(0);
	const help = spawnSync("bash", [installer, "--help"], {
		encoding: "utf8",
		env: {
			...process.env,
			AGENTSIMS_INSTALL_DIR: join(directory, "unused install"),
		},
	});
	expect(help.status).toBe(0);
	expect(existsSync(join(directory, "unused install"))).toBe(false);
	const manifest = JSON.parse(
		readFileSync(join(library, "package.json"), "utf8"),
	);
	expect(manifest).toEqual({ name: "agentsims", version, type: "module" });
	expect(readdirSync(join(library, "dist")).sort()).toEqual(
		[...LIBRARY_ARTIFACTS, "types"].sort(),
	);
});

test("the emitted installer and formula select the same exact release and hashes", () => {
	const metadata = prepare();
	const bin = join(directory, "fixture tools");
	const installed = join(directory, "installed runtime");
	write(
		join(bin, "curl"),
		`#!/bin/sh
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; destination=$1 ;;
    https://*) url=$1 ;;
  esac
  shift
done
case "$url" in
  https://github.com/${repository}/releases/download/v${version}/*) cp "$FIXTURE_RELEASE/\${url##*/}" "$destination" ;;
  *) exit 9 ;;
esac
`,
		0o755,
	);
	const result = spawnSync("bash", [join(release, "install.sh")], {
		encoding: "utf8",
		timeout: 10000,
		env: {
			...process.env,
			PATH: `${bin}:${process.env.PATH}`,
			FIXTURE_RELEASE: release,
			AGENTSIMS_INSTALL_DIR: installed,
			AGENTSIMS_INSTALL_QUIET: "1",
		},
	});
	expect(result.stderr).toBe("");
	expect(result.status).toBe(0);
	expect(
		spawnSync(join(installed, "bin/agentsims"), ["--version"], {
			encoding: "utf8",
		}).stdout.trim(),
	).toBe(version);
	const harness = join(directory, "metadata.rb");
	write(
		harness,
		`require "json"
class Formula
  def self.desc(*); end
  def self.homepage(*); end
  def self.license(*); end
  def self.depends_on(*); end
  def self.version(value); @version = value; end
  def self.url(value); (@urls ||= []) << value; end
  def self.sha256(value); (@hashes ||= []) << value; end
  def self.on_macos; yield; end
  def self.on_linux; yield; end
  def self.on_arm; yield; end
  def self.on_intel; yield; end
  def self.test; end
  def self.report; {version: @version, urls: @urls, hashes: @hashes}; end
end
load ARGV.fetch(0)
puts JSON.generate(Agentsims.report)
`,
	);
	const formula = spawnSync("ruby", [harness, join(release, "agentsims.rb")], {
		encoding: "utf8",
		timeout: 5000,
	});
	expect(formula.status).toBe(0);
	const configuration = JSON.parse(formula.stdout);
	expect(configuration.version).toBe(version);
	expect(configuration.urls).toEqual(
		HOMEBREW_TARGETS.map(
			(target) =>
				`https://github.com/${repository}/releases/download/v${version}/${runtimeArchiveName(target)}`,
		),
	);
	expect(configuration.hashes).toEqual(
		HOMEBREW_TARGETS.map((target) => metadata.artifacts[target].sha256),
	);
});

test.each([...RUNTIME_TARGETS])(
	"a missing %s target blocks every output",
	(target) => {
		rmSync(join(artifacts, target), { recursive: true });
		rejectBeforeOutput();
	},
);

test("an unsupported target cannot join the release", () => {
	mkdirSync(join(artifacts, "linux-arm64"));
	rejectBeforeOutput("Unexpected release target");
});

test.each(["version", "repository", "target", "schemaVersion", "file"])(
	"mismatched %s metadata blocks every output",
	(field) => {
		const path = recordPath("darwin-x64");
		const metadata = JSON.parse(readFileSync(path, "utf8"));
		metadata[field] = field === "schemaVersion" ? 2 : "wrong";
		write(path, JSON.stringify(metadata));
		rejectBeforeOutput("The artifact metadata does not match darwin-x64");
	},
);

test.each(["runtime", "library"] as const)(
	"a changed %s archive fails its recorded checksum",
	(kind) => {
		write(archive("linux-x64", kind), "changed after verification\n");
		rejectBeforeOutput(
			kind === "runtime"
				? "The artifact checksum does not match linux-x64"
				: "The npm library checksum does not match the release",
		);
	},
);

test.each(
	RUNTIME_TARGETS.flatMap((target) =>
		[
			"LICENSE",
			...runtimeArtifacts(target).map(
				(asset) => `dist/${asset === "preview" ? "preview/index.html" : asset}`,
			),
		].map((asset) => ({ target, asset })),
	),
)("missing asset $target/$asset blocks every output", ({ target, asset }) => {
	rmSync(join(source(target, "runtime"), asset));
	pack(target, "runtime");
	record(target);
	rejectBeforeOutput(`The release asset is missing or empty: ${asset}`);
});

test("an empty native helper cannot pass the asset gate", () => {
	write(
		join(
			source("darwin-arm64", "runtime"),
			"dist/simcam/agentsims-camera-helper",
		),
		"",
	);
	pack("darwin-arm64", "runtime");
	record("darwin-arm64");
	rejectBeforeOutput("missing or empty");
});

test("an executable with no execute bit cannot pass the asset gate", () => {
	chmodSync(join(source("linux-x64", "runtime"), "dist/agentsims"), 0o644);
	pack("linux-x64", "runtime");
	record("linux-x64");
	rejectBeforeOutput("not executable");
});

test("Windows files need no POSIX execute bit and retain their exe name", () => {
	chmodSync(
		join(source("windows-x64", "runtime"), "dist/agentsims.exe"),
		0o644,
	);
	pack("windows-x64", "runtime");
	record("windows-x64");
	expect(prepare().artifacts["windows-x64"].sha256).toBe(
		checksum(archive("windows-x64", "runtime")),
	);
});

test("Windows archives reject a POSIX executable name and Apple helpers", () => {
	rmSync(join(source("windows-x64", "runtime"), "dist/agentsims.exe"));
	write(join(source("windows-x64", "runtime"), "dist/agentsims"));
	pack("windows-x64", "runtime");
	record("windows-x64");
	rejectBeforeOutput("dist/agentsims.exe");
	write(join(source("windows-x64", "runtime"), "dist/agentsims.exe"));
	rmSync(join(source("windows-x64", "runtime"), "dist/agentsims"));
	write(
		join(source("windows-x64", "runtime"), "dist/native/agentsims-native.node"),
	);
	pack("windows-x64", "runtime");
	record("windows-x64");
	rejectBeforeOutput("Unexpected runtime asset for windows-x64");
});

test("a changed Windows archive blocks release and library preparation", () => {
	write(archive("windows-x64", "runtime"), "changed Windows download\n");
	rejectBeforeOutput("The artifact checksum does not match windows-x64");
});

test("unexpected runtime files cannot join the release", () => {
	write(join(source("linux-x64", "runtime"), "dist/unexpected.node"));
	pack("linux-x64", "runtime");
	record("linux-x64");
	rejectBeforeOutput("Unexpected runtime asset");
});

test("archive links cannot escape the asset inventory", () => {
	symlinkSync(
		"../agentsims",
		join(source("linux-x64", "runtime"), "dist/preview/linked"),
	);
	pack("linux-x64", "runtime");
	record("linux-x64");
	rejectBeforeOutput("unsupported file types");
});

test.each([
	"bin",
	"scripts",
	"optionalDependencies",
	"agentsimsRuntime",
	"name",
	"version",
	"private",
])("npm library metadata cannot carry invalid %s", (field) => {
	const path = join(source("linux-x64", "library"), "package.json");
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	manifest[field] =
		field === "private"
			? true
			: field === "name" || field === "version"
				? "wrong"
				: {};
	write(path, JSON.stringify(manifest));
	pack("linux-x64", "library");
	recordPortable();
	rejectBeforeOutput("npm library");
});

test.each([
	"dist/agentsims",
	"dist/agentsims.exe",
	"dist/preview/index.html",
	"dist/native/agentsims-native.node",
])("npm library cannot contain runtime file %s", (asset) => {
	write(join(source("darwin-x64", "library"), asset));
	pack("darwin-x64", "library");
	recordPortable();
	rejectBeforeOutput("The npm library contains a runtime file");
});

test("the npm library cannot depend on an npm runtime package", () => {
	write(
		join(source("linux-x64", "library"), "package.json"),
		JSON.stringify({
			name: "agentsims",
			version,
			dependencies: { "agentsims-runtime-linux-x64": version },
		}),
	);
	pack("linux-x64", "library");
	recordPortable();
	rejectBeforeOutput("depends on an npm runtime package");
});

test("a missing declaration root blocks library publication", () => {
	rmSync(
		join(
			source("darwin-arm64", "library"),
			"dist/types",
			LIBRARY_DECLARATIONS[0],
		),
	);
	pack("darwin-arm64", "library");
	recordPortable();
	rejectBeforeOutput("missing or empty");
});

test("preparation never overwrites prior output", () => {
	mkdirSync(release);
	write(join(release, "prior"), "preserve me\n");
	expect(prepare).toThrow("must not exist");
	expect(readFileSync(join(release, "prior"), "utf8")).toBe("preserve me\n");
	expect(existsSync(library)).toBe(false);
});

test("malformed release data cannot overwrite an existing formula or release", () => {
	prepare();
	const outputPaths = [
		...readdirSync(release).map((name) => join(release, name)),
		join(library, "package.json"),
	];
	const prior = outputPaths.map((path) => readFileSync(path));
	write(recordPath("darwin-arm64"), JSON.stringify({ schemaVersion: 2 }));
	const result = spawnSync(
		process.execPath,
		[
			resolve(import.meta.dir, "../../../scripts/prepare-release.ts"),
			"prepare",
			version,
			repository,
			artifacts,
			release,
			library,
		],
		{ encoding: "utf8", timeout: 10000 },
	);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("must not exist");
	for (const [index, path] of outputPaths.entries()) {
		expect(readFileSync(path)).toEqual(prior[index]);
	}
});

test("the package command forwards native, portable, and preparation arguments", () => {
	const target = runtimeTarget(process.platform, process.arch)!;
	const buildDirectory = join(directory, "build output");
	mkdirSync(join(buildDirectory, "releases"), { recursive: true });
	cpSync(
		archive(target, "runtime"),
		join(buildDirectory, "releases", runtimeArchiveName(target)),
	);
	const pluginArchive = join(directory, "portable plugin input.tar.gz");
	cpSync(join(artifacts, "portable", CHATGPT_ARCHIVE_NAME), pluginArchive);
	const commands = [
		[
			"run",
			"release:prepare",
			"record",
			target,
			version,
			repository,
			join(artifacts, target),
			"--build-directory",
			buildDirectory,
		],
		[
			"run",
			"--cwd",
			resolve(import.meta.dir, "../../.."),
			"release:prepare",
			"record-portable",
			version,
			repository,
			join(artifacts, "portable"),
			source(target, "library"),
			pluginArchive,
		],
		[
			"run",
			"--cwd",
			resolve(import.meta.dir, "../../.."),
			"release:prepare",
			"prepare",
			version,
			repository,
			artifacts,
			release,
			library,
		],
	];
	for (const args of commands) {
		const result = spawnSync(process.execPath, args, {
			cwd: resolve(
				import.meta.dir,
				args.includes("--cwd") ? "../../../../.." : "../../..",
			),
			encoding: "utf8",
			timeout: 10000,
		});
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
	}
	expect(JSON.parse(readFileSync(recordPath(target), "utf8")).version).toBe(
		version,
	);
	expect(
		JSON.parse(readFileSync(join(artifacts, "portable/portable.json"), "utf8"))
			.repository,
	).toBe(repository);
	expect(
		JSON.parse(readFileSync(join(release, "release-metadata.json"), "utf8"))
			.version,
	).toBe(version);
	expect(readFileSync(join(release, "agentsims.rb"), "utf8")).toContain(
		`version "${version}"`,
	);
});

test("recording executes the owned host archive and binds its version and hashes", () => {
	const target = runtimeTarget(process.platform, process.arch);
	if (!target) throw new Error("This test needs a supported build host.");
	rmSync(recordPath(target));
	const metadata = recordTargetArtifacts({
		target,
		version,
		repository,
		directory: join(artifacts, target),
	});
	expect(metadata.sha256).toBe(checksum(archive(target, "runtime")));
	expect(metadata).not.toHaveProperty("librarySha256");
	expect(JSON.parse(readFileSync(recordPath(target), "utf8"))).toEqual(
		metadata,
	);
	expect(metadata).not.toHaveProperty("directory");
	write(
		join(source(target, "runtime"), "dist", runtimeExecutableName(target)),
		"#!/bin/sh\nprintf '9.9.9\\n'\n",
		0o755,
	);
	pack(target, "runtime");
	rmSync(recordPath(target));
	expect(() =>
		recordTargetArtifacts({
			target,
			version,
			repository,
			directory: join(artifacts, target),
		}),
	).toThrow("executable version");
	expect(existsSync(recordPath(target))).toBe(false);
});

test("recording stages build outputs and verifies them before writing metadata", () => {
	const target = runtimeTarget(process.platform, process.arch)!;
	const buildDirectory = join(directory, "build output");
	const recorded = join(directory, "recorded artifacts");
	mkdirSync(join(buildDirectory, "releases"), { recursive: true });
	cpSync(
		archive(target, "runtime"),
		join(buildDirectory, "releases", runtimeArchiveName(target)),
	);
	const metadata = recordTargetArtifacts({
		target,
		version,
		repository,
		directory: recorded,
		buildDirectory,
	});
	expect(readdirSync(recorded).sort()).toEqual(
		[runtimeArchiveName(target), `${target}.json`].sort(),
	);
	expect(metadata.sha256).toBe(
		checksum(join(recorded, runtimeArchiveName(target))),
	);
	expect(metadata).not.toHaveProperty("libraryFile");
});

test("recording cannot use an archive from another build host", () => {
	const target = RUNTIME_TARGETS.find(
		(candidate) => candidate !== runtimeTarget(process.platform, process.arch),
	)!;
	expect(() =>
		recordTargetArtifacts({
			target,
			version,
			repository,
			directory: join(artifacts, target),
		}),
	).toThrow("build host");
});

test.each([
	{ version: "01.2.3", repository },
	{ version: "1.2.3-beta.1", repository },
	{ version, repository: "fixture/agentsims#suffix" },
])("invalid release identity %# fails before outputs", (identity) => {
	expect(() =>
		prepareRelease({
			...identity,
			artifactsDirectory: artifacts,
			releaseDirectory: release,
			libraryDirectory: library,
		}),
	).toThrow();
	expect(existsSync(release)).toBe(false);
	expect(existsSync(library)).toBe(false);
});

test("the CLI returns failure when the complete-target gate fails", () => {
	rmSync(join(artifacts, "darwin-x64"), { recursive: true });
	const result = spawnSync(
		process.execPath,
		[
			resolve(import.meta.dir, "../../../scripts/prepare-release.ts"),
			"prepare",
			version,
			repository,
			artifacts,
			release,
			library,
		],
		{ encoding: "utf8", timeout: 10000 },
	);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("darwin-x64");
	expect(existsSync(release)).toBe(false);
	expect(existsSync(library)).toBe(false);
});

test("a missing ChatGPT archive blocks every release output", () => {
	rmSync(join(artifacts, "portable", CHATGPT_ARCHIVE_NAME));
	rejectBeforeOutput();
});

test("a changed ChatGPT archive fails its recorded checksum", () => {
	write(
		join(artifacts, "portable", CHATGPT_ARCHIVE_NAME),
		"changed plugin archive",
	);
	rejectBeforeOutput("ChatGPT plugin checksum");
});

test("a plugin cannot replace the installed runtime with an npm launcher", () => {
	const path = join(directory, "sources/plugin/mcp.json");
	const mcp = JSON.parse(readFileSync(path, "utf8"));
	mcp.mcpServers.agentsims.command = "npx";
	write(path, JSON.stringify(mcp));
	packPlugin();
	recordPortable();
	rejectBeforeOutput("reuse the installed runtime");
});

test.each(["assets/workspace.html", "skills/getting-started/SKILL.md"])(
	"a missing plugin resource %s blocks every output",
	(asset) => {
		rmSync(join(directory, "sources/plugin", asset));
		packPlugin();
		recordPortable();
		rejectBeforeOutput("missing or empty");
	},
);

test("a plugin archive cannot contain a second runtime or its build dependencies", () => {
	write(
		join(directory, "sources/plugin/package.json"),
		JSON.stringify({ dependencies: { "@openai/mcp-extensions": "0.1.0" } }),
	);
	packPlugin();
	recordPortable();
	rejectBeforeOutput("Unexpected ChatGPT plugin asset");
});

test("a plugin resource cannot depend on an unpacked build script", () => {
	write(
		join(directory, "sources/plugin/assets/workspace.html"),
		'<html><script src="./main.js"></script></html>',
	);
	packPlugin();
	recordPortable();
	rejectBeforeOutput("HTML must contain its build assets");
});

test("a missing portable artifact set blocks every output", () => {
	rmSync(join(artifacts, "portable"), { recursive: true });
	rejectBeforeOutput();
});

test.each([
	"version",
	"repository",
	"target",
	"schemaVersion",
	"libraryFile",
	"pluginFile",
])("mismatched portable %s metadata blocks every output", (field) => {
	const path = join(artifacts, "portable/portable.json");
	const metadata = JSON.parse(readFileSync(path, "utf8"));
	metadata[field] = field === "schemaVersion" ? 2 : "wrong";
	write(path, JSON.stringify(metadata));
	rejectBeforeOutput("portable artifact metadata");
});

test("portable recording stages exactly one library and one extension with verified hashes", () => {
	const recorded = join(directory, "portable recorded");
	const metadata = recordPortableArtifacts({
		version,
		repository,
		directory: recorded,
		libraryDirectory: source("linux-x64", "library"),
		pluginArchive: join(artifacts, "portable", CHATGPT_ARCHIVE_NAME),
	});
	expect(readdirSync(recorded).sort()).toEqual(
		[LIBRARY_ARCHIVE_NAME, CHATGPT_ARCHIVE_NAME, "portable.json"].sort(),
	);
	expect(metadata.librarySha256).toBe(
		checksum(join(recorded, LIBRARY_ARCHIVE_NAME)),
	);
	expect(metadata.pluginSha256).toBe(
		checksum(join(recorded, CHATGPT_ARCHIVE_NAME)),
	);
	expect(metadata.target).toBe("portable");
	expect(
		JSON.parse(readFileSync(join(recorded, "portable.json"), "utf8")),
	).toEqual(metadata);
});

test("portable recording rejects an invalid library before it writes metadata", () => {
	const recorded = join(directory, "portable rejected");
	write(join(source("linux-x64", "library"), "dist/agentsims"));
	expect(() =>
		recordPortableArtifacts({
			version,
			repository,
			directory: recorded,
			libraryDirectory: source("linux-x64", "library"),
			pluginArchive: join(artifacts, "portable", CHATGPT_ARCHIVE_NAME),
		}),
	).toThrow("runtime file");
	expect(existsSync(join(recorded, "portable.json"))).toBe(false);
});
