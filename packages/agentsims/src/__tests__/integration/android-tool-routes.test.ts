import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { HttpApp } from "@effect/platform";
import { Effect, Stream } from "effect";
import { makeAndroidTools } from "../../core/android/device/tools";
import { AndroidTools } from "../../core/android/device/tools";
import { AndroidLogs } from "../../core/android/device/logs";
import { androidRoutes } from "../../server/http/routes/android";
import { CommandFailure } from "../../core/tools/errors";

function handler() {
	const calls: { serial: string; args: readonly string[] }[] = [];
	let installedPath: string | undefined;
	let releasedLogs = 0;
	let snapshotRequest: unknown;
	const commands = makeAndroidTools({
		run: (serial, args) =>
			Effect.sync(() => {
				calls.push({ serial, args });
				if (args[0] === "install") {
					installedPath = args[2];
					expect(existsSync(installedPath!)).toBe(true);
				}
				return "Success";
			}).pipe(
				Effect.flatMap((output) =>
					args.join(" ").includes("com.example.failed")
						? Effect.fail(new CommandFailure({ message: "ADB command failed" }))
						: Effect.succeed(output),
				),
			),
		resetSession: () => Effect.void,
	});
	const route = androidRoutes.pipe(
		Effect.provideService(AndroidTools, commands),
		Effect.provideService(AndroidLogs, {
			snapshot: (device, filter, limit) =>
				Effect.sync(() => {
					snapshotRequest = { device, filter, limit };
					return [
						{
							id: 7,
							time: "09-06 12:34:56.789",
							pid: 123,
							tid: 456,
							level: "E" as const,
							tag: "App",
							message: "failure",
						},
					];
				}),
			stream: () =>
				Stream.unwrapScoped(
					Effect.acquireRelease(
						Effect.succeed(
							Stream.concat(
								Stream.succeed({
									type: "status" as const,
									state: "connected" as const,
								}),
								Stream.never,
							),
						),
						() =>
							Effect.sync(() => {
								releasedLogs++;
							}),
					),
				),
		}),
	);
	return {
		fetch: HttpApp.toWebHandler(route),
		calls,
		get installedPath() {
			return installedPath;
		},
		get releasedLogs() {
			return releasedLogs;
		},
		get snapshotRequest() {
			return snapshotRequest;
		},
	};
}
const request = (endpoint: string, init?: RequestInit) =>
	new Request(
		`http://localhost/android/${endpoint}?device=android%3Aemulator-5554`,
		init,
	);
const post = (value: unknown) => ({
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify(value),
});

test("Android routes validate before host execution and preserve command errors", async () => {
	const app = handler();
	const invalid = await app.fetch(
		request("command", post({ type: "battery", level: -1 })),
	);
	expect(invalid.status).toBe(400);
	expect(app.calls).toHaveLength(0);
	const failedCommand = await app.fetch(
		request(
			"command",
			post({ type: "app", operation: "stop", package: "com.example.failed" }),
		),
	);
	expect(failedCommand.status).toBe(500);
	expect(await failedCommand.json()).toMatchObject({
		error: "ADB command failed",
	});
});

test("Android routes reject cross-origin writes and require a device", async () => {
	const app = handler();
	const crossOrigin = await app.fetch(
		request("command", {
			...post({ type: "apps" }),
			headers: {
				"Content-Type": "application/json",
				Origin: "https://other.example",
			},
		}),
	);
	expect(crossOrigin.status).toBe(400);
	const missing = await app.fetch(
		new Request("http://localhost/android/command", post({ type: "apps" })),
	);
	expect(missing.status).toBe(400);
	expect(app.calls).toHaveLength(0);
});

test.each([
	"null",
	"invalid origin",
	"",
	"data:text/plain,test",
	"https://localhost",
	"http://localhost:3200",
])("Android routes reject invalid or different origins: %s", async (origin) => {
	const app = handler();
	for (const endpoint of ["command", "logs"]) {
		const response = await app.fetch(
			request(
				endpoint,
				endpoint === "command"
					? {
							...post({ type: "apps" }),
							headers: { "Content-Type": "application/json", Origin: origin },
						}
					: { headers: { Origin: origin } },
			),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({
			error: "Cross-origin request blocked",
		});
	}
	expect(app.calls).toHaveLength(0);
});

test.each([undefined, "http://localhost", "http://localhost:80"])(
	"Android routes accept absent or matching origins: %s",
	async (origin) => {
		const app = handler();
		const headers = new Headers({ "Content-Type": "application/json" });
		if (origin !== undefined) headers.set("Origin", origin);
		const response = await app.fetch(
			request("command", { ...post({ type: "apps" }), headers }),
		);
		expect(response.status).toBe(200);
		expect(app.calls.length).toBeGreaterThan(0);
	},
);

test("APK upload uses a scoped server file and removes it after install", async () => {
	const app = handler();
	const result = await app.fetch(
		request("install", {
			method: "POST",
			headers: { "Content-Type": "application/vnd.android.package-archive" },
			body: new Uint8Array([80, 75, 3, 4, 5, 6]),
		}),
	);
	expect(result.status).toBe(200);
	expect(app.installedPath).toBeDefined();
	expect(existsSync(app.installedPath!)).toBe(false);
	const bad = await app.fetch(
		request("install", { method: "POST", body: "not an apk" }),
	);
	expect(bad.status).toBe(400);
	expect(app.calls).toHaveLength(1);
});

test("canceling log SSE releases its subscriber", async () => {
	const app = handler();
	const response = await app.fetch(request("logs"));
	expect(response.headers.get("Content-Type")).toContain("text/event-stream");
	const reader = response.body!.getReader();
	const first = await reader.read();
	expect(new TextDecoder().decode(first.value)).toContain('"connected"');
	await reader.cancel();
	await Bun.sleep(10);
	expect(app.releasedLogs).toBe(1);
});

test("Android log snapshot returns bounded JSON and forwards filters", async () => {
	const app = handler();
	const response = await app.fetch(
		new Request(
			"http://localhost/android/logs/snapshot?device=android%3Aemulator-5554&limit=25&level=E&query=fail&package=com.example.app&pid=123",
		),
	);
	expect(response.status).toBe(200);
	expect(response.headers.get("Content-Type")).toContain("application/json");
	expect(await response.json()).toMatchObject({
		lines: [{ id: 7, level: "E", message: "failure" }],
	});
	expect(app.snapshotRequest).toEqual({
		device: "android:emulator-5554",
		filter: {
			level: "E",
			query: "fail",
			package: "com.example.app",
			pid: 123,
		},
		limit: 25,
	});
});

test("Android state route returns structured unknown values and rejects missing devices", async () => {
	const app = handler();
	const response = await app.fetch(request("state"));
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({
		network: {
			wifi: null,
			data: null,
			airplane: null,
			downloadBps: null,
			uploadBps: null,
			minLatencyMs: null,
			maxLatencyMs: null,
		},
		battery: { level: null, charging: null, simulated: false },
		display: { density: null, talkback: false },
	});
	expect(app.calls.every((call) => call.serial === "emulator-5554")).toBe(true);
	expect(
		(await app.fetch(new Request("http://localhost/android/state"))).status,
	).toBe(400);
});
