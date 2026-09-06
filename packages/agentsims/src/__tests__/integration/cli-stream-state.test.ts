import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("follow and detach reuse existing states and preserve single/multiple JSON fields", async () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-cli-state-"));
	const ids = [
		"11111111-1111-1111-1111-111111111111",
		"22222222-2222-2222-2222-222222222222",
	];
	mkdirSync(join(directory, "agentsims"));
	const states = ids.map((device, index) => ({
		pid: process.pid,
		device,
		port: 3200 + index,
		url: `http://localhost:${3200 + index}`,
		streamUrl: `http://localhost:${3200 + index}/stream`,
		wsUrl: `ws://localhost:${3200 + index}/ws`,
	}));
	for (const state of states)
		writeFileSync(
			join(directory, "agentsims", `server-${state.device}.json`),
			JSON.stringify(state),
		);
	const inventory = JSON.stringify({
		devices: { iOS: ids.map((udid) => ({ udid, state: "Booted" })) },
	});
	writeFileSync(
		join(directory, "xcrun"),
		`#!/bin/sh\nprintf '%s' '${inventory}'\n`,
		{ mode: 0o755 },
	);
	try {
		for (const mode of ["--detach", "--no-preview"])
			for (const count of [1, 2]) {
				const child = Bun.spawn(
					[
						process.execPath,
						resolve(import.meta.dir, "../../cli/main.ts"),
						mode,
						"--quiet",
						...ids.slice(0, count),
					],
					{
						env: {
							...process.env,
							TMPDIR: directory,
							PATH: `${directory}:${process.env.PATH}`,
						},
						stdout: "pipe",
						stderr: "pipe",
					},
				);
				const [text, error, status] = await Promise.all([
					new Response(child.stdout).text(),
					new Response(child.stderr).text(),
					child.exited,
				]);
				expect(error).toBe("");
				expect(status).toBe(0);
				const expected = states
					.slice(0, count)
					.map(({ pid: _, ...state }) => state);
				expect(JSON.parse(text)).toEqual(
					count === 1 ? expected[0] : { devices: expected },
				);
			}
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}, 15000);
