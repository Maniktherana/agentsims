import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { ApplicationCommandClient } from "../../../cli/application-command-client";
import { registerRecordCommands } from "../../../cli/commands/record";
import { freePort } from "../../helpers/server";

type Call = { method: string; path: string };

const started = {
	device: "ios:A",
	path: "/tmp/agentsims/recordings/clip.mp4",
	startedAt: "2026-01-02T03:04:05.678Z",
};
const stopped = {
	device: "ios:A",
	paths: ["/tmp/a/clip.mp4", "/tmp/a/clip-2.mp4"],
	frames: 312,
	durationMs: 10_400,
	bytes: 2_345_678,
	startedAt: "2026-01-02T03:04:05.678Z",
	endedAt: "2026-01-02T03:04:16.078Z",
	ended: null,
	error: null,
};
const active = {
	device: "ios:A",
	recording: {
		path: "/tmp/a/clip.mp4",
		startedAt: "2026-01-02T03:04:05.678Z",
		frames: 42,
		bytes: 1024,
		ended: null,
	},
};

/** Run the record command against a server that answers one payload. */
async function runRecord(
	args: string[],
	answer: (call: Call) => Response,
): Promise<{ output: string; calls: Call[]; exitCode: number }> {
	const calls: Call[] = [];
	const server = Bun.serve({
		port: await freePort(),
		fetch: (request) => {
			const call = {
				method: request.method,
				path: new URL(request.url).pathname + new URL(request.url).search,
			};
			calls.push(call);
			return answer(call);
		},
	});
	const lines: string[] = [];
	const program = new Command();
	program.exitOverride();
	registerRecordCommands(program, {
		client: (url) => new ApplicationCommandClient({ origin: url }),
		write: (text) => lines.push(text),
	});
	// Other tests in the same process leave their own exit code behind.
	const before = process.exitCode;
	process.exitCode = 0;
	try {
		await program.parseAsync([...args, "--url", server.url.origin], {
			from: "user",
		});
	} finally {
		await server.stop(true);
	}
	const exitCode = Number(process.exitCode ?? 0);
	process.exitCode = before;
	return { output: lines.join(""), calls, exitCode };
}

test("start prints the path and posts the out directory", async () => {
	const result = await runRecord(
		["record", "start", "-d", "ios:A", "--out", "/tmp/runs"],
		() => Response.json(started),
	);
	expect(result.calls).toEqual([
		{
			method: "POST",
			path: "/device/ios%3AA/recording/start?out=%2Ftmp%2Fruns",
		},
	]);
	expect(result.output).toBe(
		"recording  started  device=ios:A  path=/tmp/agentsims/recordings/clip.mp4\n",
	);
	expect(result.exitCode).toBe(0);
});

test("stop prints one summary line and one path line per segment", async () => {
	const result = await runRecord(["record", "stop", "-d", "ios:A"], () =>
		Response.json(stopped),
	);
	expect(result.calls).toEqual([
		{ method: "POST", path: "/device/ios%3AA/recording/stop" },
	]);
	expect(result.output).toBe(
		[
			"recording  stopped  device=ios:A  frames=312  duration=10.4s  size=2.3MB",
			"path=/tmp/a/clip.mp4",
			"path=/tmp/a/clip-2.mp4",
			"",
		].join("\n"),
	);
	expect(result.exitCode).toBe(0);
});

test("a recording with no frames fails", async () => {
	const result = await runRecord(["record", "stop", "-d", "ios:A"], () =>
		Response.json({ ...stopped, paths: [], frames: 0, bytes: 0 }),
	);
	expect(result.output).toContain("frames=0");
	expect(result.output).toContain("path=none");
	expect(result.exitCode).toBe(1);
});

test("status reports an active recording and an idle device", async () => {
	const running = await runRecord(["record", "status", "-d", "ios:A"], () =>
		Response.json(active),
	);
	expect(running.calls).toEqual([
		{ method: "GET", path: "/device/ios%3AA/recording" },
	]);
	expect(running.output).toBe(
		"recording  active  device=ios:A  path=/tmp/a/clip.mp4  frames=42  since=2026-01-02T03:04:05.678Z\n",
	);
	const idle = await runRecord(["record", "status", "-d", "ios:A"], () =>
		Response.json({ device: "ios:A", recording: null }),
	);
	expect(idle.output).toBe("recording  none  device=ios:A\n");
});

test("a lost device shows on the stopped line", async () => {
	const result = await runRecord(["record", "stop", "-d", "ios:A"], () =>
		Response.json({ ...stopped, ended: "device_gone" }),
	);
	expect(result.output).toContain("ended=device_gone");
});

test("--json prints the server object", async () => {
	const result = await runRecord(
		["record", "stop", "-d", "ios:A", "--json"],
		() => Response.json(stopped),
	);
	expect(JSON.parse(result.output)).toEqual(stopped);
});

test("a refused start exits 1 with the server message", async () => {
	await expect(
		runRecord(["record", "start", "-d", "ios:A"], () =>
			Response.json(
				{ error: "Device ios:A is already recording.", type: "CommandConflict" },
				{ status: 409 },
			),
		),
	).rejects.toThrow("Device ios:A is already recording.");
});

test("a stop with no recording refuses", async () => {
	await expect(
		runRecord(["record", "stop", "-d", "ios:A"], () =>
			Response.json(
				{ error: "Device ios:A is not recording.", type: "CommandNotFound" },
				{ status: 404 },
			),
		),
	).rejects.toThrow("Device ios:A is not recording.");
});

test("the installed command refuses a second recording with exit 1", async () => {
	const server = Bun.serve({
		port: await freePort(),
		fetch: () =>
			Response.json(
				{ error: `Device ios:A is already recording.`, type: "CommandConflict" },
				{ status: 409 },
			),
	});
	try {
		const child = Bun.spawn(
			[
				process.execPath,
				join(resolve(import.meta.dir, "../../../.."), "src/cli/main.ts"),
				"record",
				"start",
				"-d",
				"ios:A",
				"--url",
				server.url.origin,
			],
			{ stdout: "pipe", stderr: "pipe" },
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(exitCode).toBe(1);
		expect(stdout).toBe("");
		expect(stderr).toBe("agentsims: Device ios:A is already recording.\n");
	} finally {
		await server.stop(true);
	}
});
