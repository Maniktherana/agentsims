import { expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServerProcess } from "../../../node/launch-server";

async function withMachineRuntime(
	run: (directory: string, executable: string) => Promise<void>,
) {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-managed-runtime-"));
	const executable = join(directory, "agentsims");
	const original = process.env.AGENTSIMS_BIN;
	process.env.AGENTSIMS_BIN = executable;
	try {
		await run(directory, executable);
	} finally {
		if (original === undefined) delete process.env.AGENTSIMS_BIN;
		else process.env.AGENTSIMS_BIN = original;
		rmSync(directory, { recursive: true, force: true });
	}
}

function fixture(
	executable: string,
	readiness: object,
	beforeReady = "",
): void {
	writeFileSync(
		executable,
		`#!${process.execPath}
import { appendFileSync } from "node:fs";
if (process.argv[2] === "--version") {
  console.log("8.9.10");
  process.exit(0);
}
appendFileSync("starts", "started\\n");
${beforeReady}
console.log(JSON.stringify(${JSON.stringify(readiness)}));
process.stdin.resume();
process.stdin.once("end", () => {
  appendFileSync("stopped", "closed\\n");
  process.exit(0);
});
`,
		{ mode: 0o755 },
	);
}

const compatible = {
	type: "ready",
	url: "http://127.0.0.1:12345/.sim",
	capabilities: { managedServer: 1, sourceContext: 1 },
};

test.serial(
	"lazy startup shares one owned child and passes source context",
	async () => {
		await withMachineRuntime(async (directory, executable) => {
			fixture(
				executable,
				compatible,
				`import assert from "node:assert/strict";
assert.equal(process.env.AGENTSIMS_PROJECT_ROOT, process.cwd());
assert.equal(process.env.AGENTSIMS_RN_MANIFEST, process.cwd() + "/source.jsonl");
assert.deepEqual(JSON.parse(process.env.AGENTSIMS_RN_APP_IDS), ["dev.example.app"]);
assert.deepEqual(JSON.parse(process.env.AGENTSIMS_RN_DEVICES), ["android:emulator-5554"]);`,
			);
			const preview = createServerProcess({
				basePath: "/.sim",
				projectRoot: directory,
				sourceManifestPath: "source.jsonl",
				sourceAppIds: ["dev.example.app"],
				sourceDevices: ["android:emulator-5554"],
			});
			expect(existsSync(join(directory, "starts"))).toBe(false);
			try {
				const first = preview.ready();
				expect(preview.ready()).toBe(first);
				expect(await first).toBe(compatible.url);
				expect(readFileSync(join(directory, "starts"), "utf8")).toBe(
					"started\n",
				);
			} finally {
				await preview.close();
			}
			expect(readFileSync(join(directory, "stopped"), "utf8")).toBe("closed\n");
			await expect(preview.ready()).rejects.toThrow("preview is closed");
		});
	},
);

test.serial("resolution errors permit a later explicit retry", async () => {
	await withMachineRuntime(async (directory, executable) => {
		const preview = createServerProcess({
			basePath: "/.sim",
			projectRoot: directory,
		});
		try {
			await expect(preview.ready()).rejects.toThrow("AGENTSIMS_BIN");
			fixture(executable, compatible);
			expect(await preview.ready()).toBe(compatible.url);
		} finally {
			await preview.close();
		}
	});
});

test.serial.each([
	[{ type: "ready", url: compatible.url }, "Update Agentsims"],
	[
		{ ...compatible, capabilities: { managedServer: 2, sourceContext: 1 } },
		"Update Agentsims",
	],
	[
		{ ...compatible, url: "http://127.0.0.1:12345/other" },
		"must match basePath",
	],
	[
		{ ...compatible, url: "http://user@127.0.0.1:12345/.sim" },
		"without credentials",
	],
	[
		{ ...compatible, url: "http://127.0.0.1:12345/.sim?query=yes" },
		"query or fragment",
	],
	[{ ...compatible, url: null }, "did not include a target URL"],
])(
	"rejects incompatible or malformed readiness %#",
	async (readiness, message) => {
		await withMachineRuntime(async (directory, executable) => {
			fixture(executable, readiness);
			const preview = createServerProcess({
				basePath: "/.sim",
				projectRoot: directory,
			});
			try {
				await expect(preview.ready()).rejects.toThrow(message);
			} finally {
				await preview.close();
			}
		});
	},
);

test.serial(
	"bounds total output before readiness, including ignored lines",
	async () => {
		await withMachineRuntime(async (directory, executable) => {
			fixture(
				executable,
				compatible,
				'process.stdout.write("ignored\\n".repeat(10000));',
			);
			const preview = createServerProcess({
				basePath: "/.sim",
				projectRoot: directory,
			});
			try {
				await expect(preview.ready()).rejects.toThrow("too much output");
			} finally {
				await preview.close();
			}
		});
	},
);

test.serial(
	"close without startup never probes or starts an executable",
	async () => {
		await withMachineRuntime(async (directory) => {
			const preview = createServerProcess({
				basePath: "/.sim",
				projectRoot: directory,
			});
			await preview.close();
			expect(existsSync(join(directory, "starts"))).toBe(false);
			await expect(preview.ready()).rejects.toThrow("preview is closed");
		});
	},
);
