import { expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { followLogFile } from "../../../cli/log-file";

async function until(check: () => boolean) {
	const deadline = Date.now() + 2000;
	while (!check() && Date.now() < deadline) await Bun.sleep(5);
	expect(check()).toBe(true);
}

async function fixture(run: (path: string, directory: string) => Promise<void>) {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-log-follow-"));
	try { await run(join(directory, "log with spaces.log"), directory); }
	finally { rmSync(directory, { recursive: true, force: true }); }
}

test("follow starts with the last ten lines and then appends", async () => {
	await fixture(async path => {
		const lines = Array.from({ length: 12 }, (_, index) => `line ${index + 1}\n`);
		writeFileSync(path, lines.join(""));
		const controller = new AbortController();
		let output = "";
		const done = followLogFile(path, { signal: controller.signal, pollMs: 5, chunkBytes: 8, write: text => { output += text; } });
		try {
			await until(() => output === lines.slice(2).join(""));
			appendFileSync(path, "new line\n");
			await until(() => output.endsWith("new line\n"));
			expect(output).toBe(lines.slice(2).join("") + "new line\n");
		} finally { controller.abort(); await done; }
	});
});

test("tail counts a final line without a newline", async () => {
	await fixture(async path => {
		writeFileSync(path, "one\ntwo\nthree");
		const controller = new AbortController();
		let output = "";
		const done = followLogFile(path, { signal: controller.signal, initialLines: 2, chunkBytes: 3, pollMs: 5, write: text => { output += text; } });
		try { await until(() => output === "two\nthree"); }
		finally { controller.abort(); await done; }
	});
});

test("UTF-8 survives small reads and bytes appended across polls", async () => {
	await fixture(async path => {
		writeFileSync(path, "α\n");
		const controller = new AbortController();
		let output = "";
		const done = followLogFile(path, { signal: controller.signal, chunkBytes: 1, pollMs: 5, write: text => { output += text; } });
		try {
			await until(() => output === "α\n");
			const bytes = Buffer.from("🫖 café\n");
			appendFileSync(path, bytes.subarray(0, 2));
			await Bun.sleep(25);
			expect(output).toBe("α\n");
			appendFileSync(path, bytes.subarray(2));
			await until(() => output === "α\n🫖 café\n");
			expect(output).not.toContain("�");
		} finally { controller.abort(); await done; }
	});
});

test("truncation and fast regrowth restart at the new contents", async () => {
	await fixture(async path => {
		writeFileSync(path, "old content\n");
		const controller = new AbortController();
		let output = "";
		const done = followLogFile(path, { signal: controller.signal, pollMs: 5, write: text => { output += text; } });
		try {
			await until(() => output === "old content\n");
			writeFileSync(path, "new\n");
			await until(() => output === "old content\nnew\n");
			writeFileSync(path, "regrown replacement is longer\n");
			await until(() => output.endsWith("regrown replacement is longer\n"));
			expect(output).toBe("old content\nnew\nregrown replacement is longer\n");
		} finally { controller.abort(); await done; }
	});
});

test("replacement follows the new file after a missing-path interval", async () => {
	await fixture(async (path, directory) => {
		writeFileSync(path, "first\n");
		const controller = new AbortController();
		let output = "";
		const done = followLogFile(path, { signal: controller.signal, pollMs: 5, write: text => { output += text; } });
		try {
			await until(() => output === "first\n");
			renameSync(path, join(directory, "old.log"));
			await Bun.sleep(20);
			writeFileSync(path, "replacement\n");
			await until(() => output === "first\nreplacement\n");
			appendFileSync(path, "later\n");
			await until(() => output.endsWith("later\n"));
		} finally { controller.abort(); await done; }
	});
});

test("large lines emit bounded chunks and do not queue writes", async () => {
	await fixture(async path => {
		writeFileSync(path, "x".repeat(100_000));
		const controller = new AbortController();
		let bytes = 0, active = 0, maximum = 0;
		const done = followLogFile(path, { signal: controller.signal, chunkBytes: 4096, pollMs: 5, async write(text) {
			active++; maximum = Math.max(maximum, active);
			expect(text.length).toBeLessThanOrEqual(4096);
			bytes += text.length; await Bun.sleep(1); active--;
		} });
		try { await until(() => bytes === 100_000); expect(maximum).toBe(1); }
		finally { controller.abort(); await done; }
	});
});

test("cancellation ends a long poll and a blocked output promptly", async () => {
	await fixture(async path => {
		writeFileSync(path, "ready\n");
		const controller = new AbortController();
		let writing = false;
		const done = followLogFile(path, { signal: controller.signal, pollMs: 60_000, write() { writing = true; return new Promise(() => {}); } });
		await until(() => writing);
		controller.abort();
		await done;
		const waiting = new AbortController();
		const idle = followLogFile(path, { signal: waiting.signal, initialLines: 0, pollMs: 60_000, write() { throw new Error("Unexpected output"); } });
		await Bun.sleep(20); waiting.abort(); await idle;
	});
});

test("pre-aborted follow never writes and output failures remain errors", async () => {
	await fixture(async path => {
		writeFileSync(path, "line\n");
		await followLogFile(path, { signal: AbortSignal.abort(), write() { throw new Error("Unexpected output"); } });
		await expect(followLogFile(path, { signal: new AbortController().signal, write() { throw new Error("output failed"); } })).rejects.toThrow("output failed");
	});
});
