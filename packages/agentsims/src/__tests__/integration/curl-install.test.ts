import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	readlinkSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { runtimeArchiveName, runtimeArtifacts, runtimeTarget } from "../../../scripts/release-targets";

const installer = readFileSync(resolve(import.meta.dir, "../../../scripts/install.sh"), "utf8");
const hostTarget = runtimeTarget(process.platform, process.arch);
if (!hostTarget) throw new Error("The installer tests need a supported release platform.");
const target = hostTarget;
function toolPath(name: string) {
	const path = Bun.which(name);
	if (!path) throw new Error(`The installer tests need ${name}.`);
	return path;
}
const bash = toolPath("bash");
const tar = toolPath("tar");
const realMove = toolPath("mv");

let directory: string;
let commandDirectory: string;
let releases: string;
let installRoot: string;
let temporaryDirectory: string;
let profile: string;
let requests: string;

beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "agentsims curl install ")));
	commandDirectory = join(directory, "commands");
	releases = join(directory, "releases");
	installRoot = join(directory, "runtime $literal' root");
	temporaryDirectory = join(directory, "temporary");
	profile = join(directory, "shell profile");
	requests = join(directory, "requests");
	for (const path of [commandDirectory, releases, temporaryDirectory]) mkdirSync(path);
	writeFileSync(profile, "# Existing user setting\nexport USER_SETTING=retained\n");
	writeFileSync(requests, "");
	for (const command of [
		"bash", "sh", "uname", "mkdir", "rmdir", "mktemp", "rm", "ln", "cat", "chmod",
		"cp", "awk", "tar", "gzip", "grep", "dirname", "shasum", "sha256sum",
	]) {
		const executable = Bun.which(command);
		if (executable) symlinkSync(executable, join(commandDirectory, command));
	}
	writeFileSync(join(commandDirectory, "curl"), `#!/bin/sh
output=
url=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; output=$1 ;;
    https://*) url=$1 ;;
  esac
  shift
done
printf '%s\\n' "$url" >> "$FIXTURE_REQUESTS"
cp "$FIXTURE_RELEASES/$FIXTURE_VERSION/\${url##*/}" "$output"
`, { mode: 0o755 });
	writeFileSync(join(commandDirectory, "mv"), `#!/bin/sh
for argument do destination=$argument; done
if [ "\${FIXTURE_FAIL_ACTIVATION:-}" = 1 ] && [ "$destination" = "$AGENTSIMS_INSTALL_DIR/current" ]; then
  printf 'Fixture activation failed\\n' >&2
  exit 1
fi
exec "$FIXTURE_REAL_MOVE" "$@"
`, { mode: 0o755 });
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function makeRelease(version: string, options: { missing?: string; wrongVersion?: boolean; badChecksum?: boolean } = {}) {
	const release = join(releases, version);
	const content = join(release, "content");
	mkdirSync(content, { recursive: true });
	const files = ["LICENSE", ...runtimeArtifacts(target).map((artifact) => `dist/${artifact === "preview" ? "preview/index.html" : artifact}`)];
	for (const file of files) {
		if (file === options.missing) continue;
		const path = join(content, file);
		mkdirSync(dirname(path), { recursive: true });
		if (file === "dist/agentsims") {
			writeFileSync(path, `#!/bin/sh
if [ "\${1:-}" = --version ]; then
  printf '%s\\n' '${options.wrongVersion ? "9.9.9" : version}'
else
  printf '<%s>\\n' "$@"
fi
`, { mode: 0o755 });
		} else {
			writeFileSync(path, `${version}: ${file}\n`, { mode: 0o755 });
		}
	}
	const archive = join(release, runtimeArchiveName(target));
	const result = spawnSync(tar, ["-czf", archive, "-C", content, "."], { encoding: "utf8" });
	if (result.status !== 0) throw new Error(result.stderr);
	const checksum = options.badChecksum ? "0".repeat(64) : createHash("sha256").update(readFileSync(archive)).digest("hex");
	writeFileSync(join(release, "SHA256SUMS"), `${checksum}  ${runtimeArchiveName(target)}\n`);
}

function install(version: string, args: string[] = [], extraEnv: Record<string, string> = {}) {
	const script = join(directory, `install-${version}.sh`);
	writeFileSync(script, installer.replaceAll("__AGENTSIMS_RELEASE_VERSION__", version));
	return spawnSync(bash, [script, ...args], {
		encoding: "utf8",
		timeout: 10000,
		env: {
			PATH: commandDirectory,
			TMPDIR: temporaryDirectory,
			SHELL: bash,
			AGENTSIMS_INSTALL_DIR: installRoot,
			AGENTSIMS_SHELL_PROFILE: profile,
			FIXTURE_REQUESTS: requests,
			FIXTURE_RELEASES: releases,
			FIXTURE_VERSION: version,
			FIXTURE_REAL_MOVE: realMove,
			...extraEnv,
		},
	});
}

function installedVersion() {
	const result = spawnSync(join(installRoot, "bin/agentsims"), ["--version"], {
		encoding: "utf8", timeout: 1000, env: { PATH: commandDirectory },
	});
	expect(result.status).toBe(0);
	return result.stdout.trim();
}

function expectClean() {
	expect(readdirSync(temporaryDirectory)).toEqual([]);
	expect(readdirSync(installRoot).filter((name) => name.startsWith("."))).toEqual([]);
	expect(readdirSync(join(installRoot, "versions")).filter((name) => name.startsWith("."))).toEqual([]);
}

test("curl installation and normal startup work without Node, npm, or shell edits", () => {
	makeRelease("1.0.0");
	const originalProfile = readFileSync(profile, "utf8");
	const result = install("1.0.0", [], { AGENTSIMS_SOURCE_PACKAGE: "/missing/legacy-npm-package", AGENTSIMS_INSTALL_VERSION: "9.9.9" });
	expect(result.error).toBeUndefined();
	expect(result.status).toBe(0);
	expect(installedVersion()).toBe("1.0.0");
	expect(readFileSync(profile, "utf8")).toBe(originalProfile);
	expect(existsSync(join(commandDirectory, "node"))).toBe(false);
	expect(existsSync(join(commandDirectory, "npm"))).toBe(false);
	expect(existsSync(join(commandDirectory, "npx"))).toBe(false);
	const downloads = readFileSync(requests, "utf8");
	expect(downloads.trim().split("\n")).toHaveLength(2);
	const command = spawnSync(join(installRoot, "bin/agentsims"), ["path with spaces", "$literal", "a'b"], {
		encoding: "utf8", env: { PATH: commandDirectory },
	});
	expect(command.status).toBe(0);
	expect(command.stdout).toBe("<path with spaces>\n<$literal>\n<a'b>\n");
	expect(readFileSync(requests, "utf8")).toBe(downloads);
	expectClean();
});

test("two-version upgrades, repeated installation, and rollback retain complete assets", () => {
	makeRelease("1.0.0");
	makeRelease("1.1.0");
	expect(install("1.0.0").status).toBe(0);
	const oldJar = readFileSync(join(installRoot, "versions/1.0.0/dist/android/agentsims-ax-server.jar"));
	expect(install("1.1.0").status).toBe(0);
	expect(readlinkSync(join(installRoot, "current"))).toBe("versions/1.1.0");
	expect(installedVersion()).toBe("1.1.0");
	expect(readFileSync(join(installRoot, "versions/1.0.0/dist/android/agentsims-ax-server.jar"))).toEqual(oldJar);
	const downloads = readFileSync(requests, "utf8");
	expect(install("1.1.0").status).toBe(0);
	expect(installedVersion()).toBe("1.1.0");
	expect(readFileSync(requests, "utf8")).toBe(downloads);
	expect(install("1.0.0").status).toBe(0);
	expect(readlinkSync(join(installRoot, "current"))).toBe("versions/1.0.0");
	expect(installedVersion()).toBe("1.0.0");
	expect(readFileSync(requests, "utf8")).toBe(downloads);
	for (const version of ["1.0.0", "1.1.0"]) {
		expect(readdirSync(join(installRoot, "versions", version)).sort()).toEqual(["LICENSE", "dist"]);
	}
	expectClean();
});

test("a bad checksum preserves the active release and removes staged downloads", () => {
	makeRelease("1.0.0");
	makeRelease("1.1.0", { badChecksum: true });
	expect(install("1.0.0").status).toBe(0);
	const result = install("1.1.0");
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("The archive checksum does not match.");
	expect(installedVersion()).toBe("1.0.0");
	expect(readlinkSync(join(installRoot, "current"))).toBe("versions/1.0.0");
	expect(readdirSync(join(installRoot, "versions"))).toEqual(["1.0.0"]);
	expectClean();
});

test.each([
	"LICENSE", "dist/preview/index.html", "dist/android/agentsims-ax-server.jar",
	...(target.startsWith("darwin-") ? ["dist/native/agentsims-native.node", "dist/simcam/libSimCameraInjector.dylib", "dist/simcam/agentsims-camera-helper", "dist/simax/agentsims-ax-settings"] : []),
])("a verified archive missing %s cannot replace the active release", (missing) => {
	makeRelease("1.0.0");
	makeRelease("1.1.0", { missing });
	expect(install("1.0.0").status).toBe(0);
	const result = install("1.1.0");
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("The runtime files are incomplete or have the wrong version.");
	expect(installedVersion()).toBe("1.0.0");
	expect(existsSync(join(installRoot, "versions/1.1.0"))).toBe(false);
	expectClean();
});

test("a runtime with the wrong version cannot replace the active release", () => {
	makeRelease("1.0.0");
	makeRelease("1.1.0", { wrongVersion: true });
	expect(install("1.0.0").status).toBe(0);
	expect(install("1.1.0").status).toBe(1);
	expect(installedVersion()).toBe("1.0.0");
	expectClean();
});

test("an activation failure preserves the old current link and removes the new release", () => {
	makeRelease("1.0.0");
	makeRelease("1.1.0");
	expect(install("1.0.0").status).toBe(0);
	const result = install("1.1.0", [], { FIXTURE_FAIL_ACTIVATION: "1" });
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("Fixture activation failed");
	expect(installedVersion()).toBe("1.0.0");
	expect(readlinkSync(join(installRoot, "current"))).toBe("versions/1.0.0");
	expect(existsSync(join(installRoot, "versions/1.1.0"))).toBe(false);
	expectClean();
	expect(install("1.1.0").status).toBe(0);
	expect(installedVersion()).toBe("1.1.0");
	expectClean();
});

test("a failed first activation leaves no launcher or release and can be retried", () => {
	makeRelease("1.0.0");
	expect(install("1.0.0", [], { FIXTURE_FAIL_ACTIVATION: "1" }).status).toBe(1);
	expect(existsSync(join(installRoot, "bin/agentsims"))).toBe(false);
	expect(existsSync(join(installRoot, "current"))).toBe(false);
	expect(readdirSync(join(installRoot, "versions"))).toEqual([]);
	expectClean();
	expect(install("1.0.0").status).toBe(0);
	expect(installedVersion()).toBe("1.0.0");
});

test("an incomplete existing version is retained rather than overwritten", () => {
	makeRelease("1.0.0");
	expect(install("1.0.0").status).toBe(0);
	const incomplete = join(installRoot, "versions/1.1.0");
	mkdirSync(incomplete);
	writeFileSync(join(incomplete, "existing-asset"), "keep this asset");
	const requestsBefore = readFileSync(requests, "utf8");
	const result = install("1.1.0");
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("The existing version is incomplete. It was not changed:");
	expect(readFileSync(join(incomplete, "existing-asset"), "utf8")).toBe("keep this asset");
	expect(installedVersion()).toBe("1.0.0");
	expect(readFileSync(requests, "utf8")).toBe(requestsBefore);
	expectClean();
});

test("PATH changes require the flag and repeat without duplicate entries", () => {
	makeRelease("1.0.0");
	const originalProfile = readFileSync(profile, "utf8");
	expect(install("1.0.0").status).toBe(0);
	expect(readFileSync(profile, "utf8")).toBe(originalProfile);
	expect(install("1.0.0", ["--add-to-path"]).status).toBe(0);
	const updatedProfile = readFileSync(profile, "utf8");
	expect(updatedProfile.startsWith(originalProfile)).toBe(true);
	expect(install("1.0.0", ["--add-to-path"]).status).toBe(0);
	expect(readFileSync(profile, "utf8")).toBe(updatedProfile);
	const sourced = spawnSync(bash, ["-c", '. "$1"; printf "%s" "$PATH"', "fixture", profile], {
		encoding: "utf8", env: { PATH: commandDirectory },
	});
	expect(sourced.status).toBe(0);
	expect(sourced.stdout).toBe(`${installRoot}/bin:${commandDirectory}`);
	expectClean();
});

test("an existing installer lock is not removed by another invocation", () => {
	mkdirSync(join(installRoot, ".install-lock"), { recursive: true });
	const result = install("1.0.0");
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("The install lock exists.");
	expect(existsSync(join(installRoot, ".install-lock"))).toBe(true);
	expect(readFileSync(requests, "utf8")).toBe("");
});

test("help and invalid options do not install anything", () => {
	const help = install("1.0.0", ["--help"]);
	expect(help.status).toBe(0);
	expect(help.stdout).toContain("--add-to-path");
	expect(install("1.0.0", ["--unknown"]).status).toBe(1);
	expect(existsSync(installRoot)).toBe(false);
	expect(readFileSync(requests, "utf8")).toBe("");
});
