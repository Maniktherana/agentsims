import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "../../../cli/application-command-client";
import { usablePng } from "../../fixtures/capture-images";
import { freePort } from "../../helpers/server";

const packageRoot = resolve(import.meta.dir, "../../../..");
const cli = join(packageRoot, "src/cli/main.ts");
const roots: string[] = [];
const png = usablePng(10, 20);
const bytes = { $agentsimsBytes: png.toString("base64") };

function temporaryRoot(): string {
	const value = mkdtempSync(join(tmpdir(), "agentsims-cli-output-"));
	roots.push(value);
	return value;
}

afterEach(() => {
	for (const value of roots.splice(0)) rmSync(value, { recursive: true });
});

async function runCli(
	args: string[],
	environment: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const { AGENTSIMS_SCREENSHOT_DIR: _screenshotDir, ...baseEnvironment } = process.env;
	const child = Bun.spawn([process.execPath, cli, ...args], {
		cwd: packageRoot,
		env: { ...baseEnvironment, ...environment },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

const context = {
	app: "com.example.app",
	orientation: "portrait",
	generation: 1,
	changedDuringCapture: false,
	before: { status: "ok", capturedAt: 1, value: {} },
	after: { status: "ok", capturedAt: 2, value: {} },
};

function image(captureId = "c1", observationId: string | null = "o1") {
	return {
		status: "ok",
		capturedAt: 2,
		value: {
			bytes,
			mimeType: "image/png",
			width: 10,
			height: 20,
			captureId,
			observationId,
		},
	};
}

const view = {
	id: "o1",
	device: "ios-device",
	platform: "ios",
	app: "com.example.app",
	screen: { width: 10, height: 20 },
	nodes: [],
	shown: 0,
	total: 0,
	warnings: [],
};

function observation() {
	return {
		device: "ios-device",
		platform: "ios",
		startedAt: 1,
		completedAt: 3,
		observationId: "o1",
		captureId: "c1",
		accessibility: {
			status: "ok",
			capturedAt: 2,
			value: {
				observationId: "o1",
				snapshot: { screen: { width: 10, height: 20 }, elements: [] },
				view,
			},
		},
		image: image(),
		context,
		view,
		warnings: [],
	};
}

function action(imageValue: unknown = null) {
	return {
		device: "ios-device",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "matched",
			reason: "The result matches.",
			observed: { value: "done" },
		},
		resolved: [{ type: "button", button: "home" }],
		accessibility: {
			status: "ok",
			capturedAt: 3,
			value: {
				observationId: "o1",
				snapshot: { screen: { width: 10, height: 20 }, elements: [] },
				view,
			},
		},
		view,
		image: imageValue,
		captureReason: imageValue ? "explicit" : null,
		warnings: [],
	};
}

test("observe JSON exposes one AX view and writes a separate artifact", async () => {
	const directory = temporaryRoot();
	const server = Bun.serve({ port: await freePort(), fetch: () => Response.json(observation()) });
	try {
		const result = await runCli(
			["observe", "-d", "ios-device", "--json", "--url", server.url.origin],
			{ AGENTSIMS_SCREENSHOT_DIR: directory },
		);
		expect(result).toMatchObject({ exitCode: 0, stderr: "" });
		const output = JSON.parse(result.stdout);
		expect(output.view).toEqual(view);
		expect(output.accessibility.value).toEqual({ observationId: "o1" });
		expect(output.image.value).toEqual({
			mimeType: "image/png",
			width: 10,
			height: 20,
			captureId: "c1",
			observationId: "o1",
		});
		expect(output.artifact.status).toBe("ok");
		expect(output.artifact.path.startsWith(resolve(directory))).toBe(true);
		expect(existsSync(output.artifact.path)).toBe(true);
		expect(readFileSync(output.artifact.path)).toEqual(png);
		expect(result.stdout).not.toContain("$agentsimsBytes");
		expect(result.stdout).not.toContain('"snapshot"');
		expect(result.stdout).not.toContain('"quality"');
	} finally {
		await server.stop(true);
	}
});

test("artifact failure keeps action evidence and returns failure", async () => {
	const directory = temporaryRoot();
	const unusableDirectory = join(directory, "not-a-directory");
	writeFileSync(unusableDirectory, "keep");
	const server = Bun.serve({ port: await freePort(), fetch: () => Response.json(action(image())) });
	try {
		const result = await runCli(
			[
				"press", "home", "-d", "ios-device", "--screenshot", "--json",
				"--url", server.url.origin,
			],
			{ AGENTSIMS_SCREENSHOT_DIR: unusableDirectory },
		);
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("");
		const output = JSON.parse(result.stdout);
		expect(output.dispatch.status).toBe("accepted");
		expect(output.verification.status).toBe("matched");
		expect(output.view).toEqual(view);
		expect(output.image.value.captureId).toBe("c1");
		expect(output.image.value).not.toHaveProperty("bytes");
		expect(output.artifact).toMatchObject({
			status: "error",
			error: expect.stringContaining("Screenshot write failed"),
		});
		expect(readFileSync(unusableDirectory, "utf8")).toBe("keep");
	} finally {
		await server.stop(true);
	}
});

test("human output keeps both failed observation channels", async () => {
	const server = Bun.serve({
		port: await freePort(),
		fetch: () => Response.json({
			...observation(),
			observationId: null,
			view: null,
			accessibility: { status: "error", capturedAt: 2, error: "AX is starting" },
			image: { status: "error", capturedAt: 2, error: "The image format is invalid" },
		}),
	});
	try {
		const result = await runCli(["observe", "-d", "ios-device", "--url", server.url.origin]);
		expect(result.exitCode).toBe(1);
		expect(result.stdout).toContain("accessibility  error");
		expect(result.stdout).toContain("AX is starting");
		expect(result.stdout).toContain("image  error");
		expect(result.stdout).toContain("The image format is invalid");
		expect(result.stdout).not.toContain("quality=");
	} finally {
		await server.stop(true);
	}
});

test("a lost action response is uncertain and is not retried", async () => {
	let requests = 0;
	let received!: () => void;
	const requestReceived = new Promise<void>((resolve) => {
		received = resolve;
	});
	const server = Bun.serve({
		port: await freePort(),
		fetch() {
			requests += 1;
			received();
			return new Promise<Response>(() => {});
		},
	});
	try {
		const controller = new AbortController();
		const client = new ApplicationCommandClient({
			origin: server.url.origin,
			signal: controller.signal,
		});
		const response = client.actDevice("ios-device", [{ type: "button", button: "home" }]);
		await requestReceived;
		controller.abort();
		const error = await response.catch((cause) => cause);
		expect(error).toBeInstanceOf(CommandRequestError);
		expect(error.effect).toBe("unknown");
		expect(requests).toBe(1);
	} finally {
		await server.stop(true);
	}
});

test("a stalled HTTP request reaches its deadline", async () => {
	const server = Bun.serve({ port: await freePort(), fetch: () => new Promise<Response>(() => {}) });
	try {
		const client = new ApplicationCommandClient({ origin: server.url.origin, timeoutMs: 20 });
		await expect(client.status()).rejects.toThrow("The request timed out after 20 ms.");
	} finally {
		await server.stop(true);
	}
});

test("app screenshot requests are forwarded for launch and stop", async () => {
	const paths: string[] = [];
	const server = Bun.serve({
		port: await freePort(),
		fetch(request) {
			const url = new URL(request.url);
			paths.push(url.pathname + url.search);
			return Response.json(action(image()));
		},
	});
	try {
		for (const operation of ["launch", "stop"]) {
			const result = await runCli([
				"app", operation, "com.example.app", "-d", "ios-device",
				"--screenshot", "--url", server.url.origin,
			]);
			expect(result.exitCode).toBe(0);
		}
		expect(paths).toEqual([
			"/device/ios-device/app?screenshot=1",
			"/device/ios-device/app?screenshot=1",
		]);
	} finally {
		await server.stop(true);
	}
});

test("device logs keep filters in human and raw JSON modes", async () => {
	const requests: string[] = [];
	const payload = {
		lines: [{
			id: 7,
			time: "09-06 12:34:56.789",
			pid: 123,
			tid: 456,
			level: "E",
			tag: "ReactNativeJS",
			message: "Request failed",
		}],
	};
	const server = Bun.serve({
		port: await freePort(),
		fetch(request) {
			const url = new URL(request.url);
			requests.push(url.pathname + url.search);
			return Response.json(payload);
		},
	});
	const args = [
		"device-logs", "-d", "android:emulator-5554", "--limit", "25",
		"--level", "e", "--query", "failed", "--app", "com.example.app",
		"--pid", "123", "--url", server.url.origin,
	];
	try {
		const human = await runCli(args);
		expect(human).toMatchObject({
			exitCode: 0,
			stdout: "09-06 12:34:56.789 E ReactNativeJS Request failed\n",
		});
		const raw = await runCli([...args, "--json"]);
		expect(JSON.parse(raw.stdout)).toEqual(payload);
		expect(requests).toEqual(Array(2).fill(
			"/android/logs/snapshot?device=android%3Aemulator-5554&limit=25&level=E&query=failed&package=com.example.app&pid=123",
		));
	} finally {
		await server.stop(true);
	}
});
