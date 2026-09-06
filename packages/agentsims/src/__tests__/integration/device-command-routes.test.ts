import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { InvalidCommandInput } from "../../shared/application-errors";
import type { PreviewServer } from "../../server/http/server";
import { startTestServer, type TestServerOverrides } from "../helpers/server";

const servers: PreviewServer[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop();
});

async function startServer(
	commands: NonNullable<TestServerOverrides["deviceCommands"]>,
	basePath = "/",
) {
	const result = await startTestServer({
		deviceCommands: commands,
		basePath,
	});
	servers.push(result.server);
	return result.origin;
}

function commandStubs(
	overrides: Partial<NonNullable<TestServerOverrides["deviceCommands"]>> = {},
) {
	return {
		list: () => Effect.succeed({ devices: [], total: 0, offset: 0, limit: 0 }),
		memory: () =>
			Effect.succeed({
				totalBytes: 1,
				availableBytes: 1,
				runningSimulators: 0,
				processes: [],
			}),
		workspaces: () => Effect.succeed([]),
		observe: (device: string) =>
			Effect.succeed({
				device,
				platform: "android" as const,
				capturedAt: 1,
				screenshot: { mimeType: "image/png", contentBase64: "", bytes: 0 },
				config: {},
				accessibility: null,
				warnings: [],
			}),
		act: () => Effect.void,
		start: (device: string) => Effect.succeed({ device }),
		shutdown: () => Effect.void,
		...overrides,
	};
}

describe("device command routes", () => {
	test("mounts command and feature routes under the same configured base path", async () => {
		const origin = await startServer(commandStubs(), "/workspace/phone");
		const responses = await Promise.all([
			fetch(`${origin}/workspace/phone/status`),
			fetch(`${origin}/status`),
			fetch(`${origin}/workspace/phone/capabilities`),
			fetch(`${origin}/workspace/phone/grid/api/device-frame-assets`),
		]);

		expect(responses.map((response) => response.status)).toEqual([
			200, 200, 200, 400,
		]);
		expect(await responses[0]!.json()).toEqual({ workspaces: [] });
		expect(await responses[1]!.json()).toEqual({ workspaces: [] });
		expect(await responses[2]!.json()).toMatchObject({
			platforms: expect.arrayContaining(["android"]),
		});
	});

	test("rejects malformed and oversized JSON before calling a command", async () => {
		let calls = 0;
		const origin = await startServer(
			commandStubs({
				act: () =>
					Effect.sync(() => {
						calls += 1;
					}),
			}),
		);

		for (const body of [
			"{",
			"{}",
			JSON.stringify({ actions: "tap" }),
			JSON.stringify({ actions: [], extra: "x".repeat(1024 * 1024) }),
		]) {
			const response = await fetch(
				`${origin}/device/android:emulator-5554/act`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body,
				},
			);
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({
				type: "InvalidCommandInput",
			});
		}
		expect(calls).toBe(0);
	});

	test("interrupts command work when the HTTP client disconnects", async () => {
		const started = Promise.withResolvers<void>();
		const interrupted = Promise.withResolvers<void>();
		const origin = await startServer(
			commandStubs({
				act: () =>
					Effect.sync(started.resolve).pipe(
						Effect.andThen(Effect.never),
						Effect.onInterrupt(() => Effect.sync(interrupted.resolve)),
					),
			}),
		);
		const controller = new AbortController();
		const request = fetch(`${origin}/device/android:emulator-5554/act`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ actions: [] }),
			signal: controller.signal,
		}).catch(() => undefined);

		await started.promise;
		controller.abort();
		await request;
		await interrupted.promise;
	}, 3_000);

	test("serves workspace status through HTTP", async () => {
		const workspaces = [{ device: "android:emulator-5554" }];
		const origin = await startServer(
			commandStubs({
				workspaces: () => Effect.succeed(workspaces as never),
			}),
		);

		const response = await fetch(`${origin}/status`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ workspaces });
	});

	test("serves memory status through the device command boundary", async () => {
		const report = {
			totalBytes: 10,
			availableBytes: 4,
			runningSimulators: 1,
			processes: [],
		};
		const origin = await startServer(
			commandStubs({
				memory: () => Effect.succeed(report),
			}),
		);

		const response = await fetch(`${origin}/grid/api/memory`);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(report);
	});

	test("decodes the device id and accessibility option for observe", async () => {
		const calls: unknown[] = [];
		const origin = await startServer(
			commandStubs({
				observe: (device, includeAccessibility) =>
					Effect.sync(() => {
						calls.push({ device, includeAccessibility });
						return {
							device,
							platform: "android" as const,
							capturedAt: 1,
							screenshot: {
								mimeType: "image/png",
								contentBase64: "",
								bytes: 0,
							},
							config: {},
							accessibility: null,
							warnings: [],
						};
					}),
			}),
		);

		const response = await fetch(
			`${origin}/device/${encodeURIComponent("android:emulator-5554")}/observe?ax=0`,
		);

		expect(response.status).toBe(200);
		expect(calls).toEqual([
			{
				device: "android:emulator-5554",
				includeAccessibility: false,
			},
		]);
	});

	test("posts one validated action batch and reports completion", async () => {
		const calls: unknown[] = [];
		const origin = await startServer(
			commandStubs({
				act: (device, actions) =>
					Effect.sync(() => {
						calls.push({ device, actions });
					}),
			}),
		);
		const actions = [{ type: "tap", x: 0.5, y: 0.7 }];

		const response = await fetch(
			`${origin}/device/${encodeURIComponent("ios:device")}/act`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ actions }),
			},
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(calls).toEqual([{ device: "ios:device", actions }]);
	});

	test("maps tagged command errors through the shared HTTP policy", async () => {
		const origin = await startServer(
			commandStubs({
				act: () =>
					Effect.fail(
						new InvalidCommandInput({ message: "Invalid action batch" }),
					),
			}),
		);
		const response = await fetch(
			`${origin}/device/${encodeURIComponent("ios:device")}/act`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ actions: [{}] }),
			},
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid action batch",
			type: "InvalidCommandInput",
		});
	});

	test("rejects a simple cross-origin action request", async () => {
		const origin = await startServer(commandStubs());
		const response = await fetch(
			`${origin}/device/${encodeURIComponent("ios:device")}/act`,
			{
				method: "POST",
				headers: {
					"Content-Type": "text/plain",
					Origin: "https://attacker.example",
				},
				body: "{}",
			},
		);

		expect(response.status).toBe(415);
	});

	test("mounts DeviceKit asset requests before the preview fallback", async () => {
		const origin = await startServer(commandStubs());

		const response = await fetch(`${origin}/grid/api/device-frame-assets`);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			ok: false,
			error: "Invalid device frame asset request",
		});
	});
});
