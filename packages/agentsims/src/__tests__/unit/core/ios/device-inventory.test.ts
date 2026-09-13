import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
const inventoryModule = pathToFileURL(
	resolve(import.meta.dir, "../../../../core/ios/devices.ts"),
).href;

function fixture(
	code: string,
	inventory: unknown = { devices: {} },
	exitCode = 0,
) {
	const root = mkdtempSync(join(tmpdir(), "agentsims-inventory-"));
	roots.push(root);
	const calls = join(root, "calls");
	const data = join(root, "inventory.json");
	writeFileSync(
		data,
		typeof inventory === "string" ? inventory : JSON.stringify(inventory),
	);
	writeFileSync(
		join(root, "xcrun"),
		'#!/bin/sh\nprintf "%s\\n" "$*" > "$AGENTSIMS_TEST_CALLS"\ncat "$AGENTSIMS_TEST_INVENTORY"\nexit "$AGENTSIMS_TEST_EXIT"\n',
		{ mode: 0o755 },
	);
	const result = spawnSync(process.execPath, ["--eval", code], {
		encoding: "utf8",
		timeout: 10_000,
		env: {
			...process.env,
			PATH: `${root}:/usr/bin:/bin`,
			TMPDIR: root,
			AGENTSIMS_TEST_CALLS: calls,
			AGENTSIMS_TEST_INVENTORY: data,
			AGENTSIMS_TEST_EXIT: String(exitCode),
		},
	});
	expect(result.status, result.stderr).toBe(0);
	return { value: JSON.parse(result.stdout), calls };
}

test("shared inventory preserves runtime groups, metadata, and unavailable entries", () => {
	const devices = {
		"com.apple.CoreSimulator.SimRuntime.iOS-18-0": [
			{
				udid: "PHONE",
				name: "iPhone",
				state: "Booted",
				isAvailable: true,
				deviceTypeIdentifier: "phone.type",
			},
			{
				udid: "MISSING",
				name: "Old phone",
				state: "Shutdown",
				isAvailable: false,
			},
		],
	};
	const result = fixture(
		`const { listIosDevices } = await import(${JSON.stringify(inventoryModule)}); console.log(JSON.stringify(await listIosDevices({ platform: "darwin", booted: true, timeoutMs: 3000 })));`,
		{ devices },
	);
	expect(result.value).toEqual(devices);
	expect(readFileSync(result.calls, "utf8").trim()).toBe(
		"simctl list devices booted -j",
	);
});

test("failed or malformed inventories retain the null result", () => {
	const code = `const { listIosDevices } = await import(${JSON.stringify(inventoryModule)}); console.log(JSON.stringify(await listIosDevices({ platform: "darwin" })));`;
	expect(fixture(code, { devices: {} }, 7).value).toBeNull();
	expect(fixture(code, "invalid json").value).toBeNull();
});

test("Linux inventory never starts an Apple command", () => {
	const result = fixture(
		`const { listIosDevices } = await import(${JSON.stringify(inventoryModule)}); console.log(JSON.stringify(await listIosDevices({ platform: "linux" })));`,
	);
	expect(result.value).toBeNull();
	expect(existsSync(result.calls)).toBe(false);
});
