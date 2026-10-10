import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRelease } from "../../../scripts/release";
import {
	CHATGPT_ARCHIVE_NAME,
	RUNTIME_TARGETS,
	runtimeArchiveName,
} from "../../../scripts/release-targets";

let directory: string;
const archives = [
	...RUNTIME_TARGETS.map(runtimeArchiveName),
	CHATGPT_ARCHIVE_NAME,
];
const sha256 = (file: string) =>
	createHash("sha256")
		.update(readFileSync(join(directory, file)))
		.digest("hex");

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "agentsims release "));
	for (const file of archives) writeFileSync(join(directory, file), file);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("the checksums, metadata, installer, and formula select the same archives", () => {
	const metadata = writeRelease("0.1.0", directory);
	const checksums = readFileSync(join(directory, "SHA256SUMS"), "utf8");
	for (const file of archives)
		expect(checksums).toContain(`${sha256(file)}  ${file}\n`);
	expect(
		JSON.parse(readFileSync(join(directory, "release-metadata.json"), "utf8")),
	).toEqual(metadata);
	expect(metadata.artifacts["windows-x64"]).toEqual({
		file: "agentsims-windows-x64.tar.gz",
		sha256: sha256("agentsims-windows-x64.tar.gz"),
	});

	const installer = readFileSync(join(directory, "install.sh"), "utf8");
	expect(installer).toContain("version=0.1.0\n");
	expect(installer).not.toContain("__AGENTSIMS_");
	expect(spawnSync("bash", ["-n", join(directory, "install.sh")]).status).toBe(
		0,
	);

	const formula = readFileSync(join(directory, "agentsims.rb"), "utf8");
	expect(formula).toContain('version "0.1.0"');
	for (const target of ["darwin-arm64", "darwin-x64", "linux-x64"] as const) {
		expect(formula).toContain(
			`url "https://github.com/Maniktherana/agentsims/releases/download/v0.1.0/${runtimeArchiveName(target)}"\n      sha256 "${metadata.artifacts[target].sha256}"`,
		);
	}
	expect(formula).not.toContain("windows");
	const ruby = Bun.which("ruby");
	if (ruby)
		expect(
			spawnSync(ruby, ["-c", join(directory, "agentsims.rb")]).status,
		).toBe(0);
});

test("an invalid version or a missing archive writes no release files", () => {
	expect(() => writeRelease("0.1", directory)).toThrow(
		"The release version must have the form 1.2.3.",
	);
	rmSync(join(directory, runtimeArchiveName("linux-x64")));
	expect(() => writeRelease("0.1.0", directory)).toThrow();
	for (const file of ["SHA256SUMS", "agentsims.rb", "install.sh"])
		expect(() => readFileSync(join(directory, file))).toThrow();
});
