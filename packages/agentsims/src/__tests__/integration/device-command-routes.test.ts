import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { InvalidCommandInput } from "../../commands/errors";
import type { PreviewServer } from "../../server/runtime/runtime";
import { startTestServer, type TestServerOverrides } from "../helpers/server";

const servers: PreviewServer[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop();
});

async function startServer(
	commands: NonNullable<TestServerOverrides["deviceCommands"]>,
) {
	const result = await startTestServer({
		deviceCommands: commands,
		previewAssets: {},
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
