import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const cli = resolve(import.meta.dir, "../../../../cli/main.ts");
let directory: string;

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "agentsims skill "));
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

function skill(args: string[]) {
	return spawnSync(process.execPath, [cli, "skill", ...args], {
		encoding: "utf8",
		timeout: 10000,
		env: { PATH: directory, FIXTURE_ARGUMENTS: join(directory, "arguments") },
	});
}

test("skill runs the skills CLI for this repository and returns its exit code", () => {
	writeFileSync(
		join(directory, "npx"),
		`#!/bin/sh\nprintf '%s\\n' "$@" > "$FIXTURE_ARGUMENTS"\nexit 3\n`,
		{ mode: 0o755 },
	);
	const result = skill(["--global", "--agent", "claude-code", "--yes"]);
	expect(result.status).toBe(3);
	expect(readFileSync(join(directory, "arguments"), "utf8").trim().split("\n")).toEqual([
		"-y", "skills", "add", "Maniktherana/agentsims", "--skill", "agentsims",
		"--global", "--agent", "claude-code", "--yes",
	]);
});

test("skill without npx tells the user to install Node.js", () => {
	const result = skill([]);
	expect(result.status).toBe(1);
	expect(result.stderr).toContain("Node.js 20 or newer is necessary to install the skill.");
});
