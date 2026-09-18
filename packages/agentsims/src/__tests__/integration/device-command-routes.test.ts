import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "../../cli/application-command-client";
import { makeDeviceService } from "../../core/tools/devices/devices";
import { DeviceGone } from "../../core/tools/errors";
import type { PreviewServer } from "../../server/http/server";
import { androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer, type TestServerOverrides } from "../helpers/server";

const servers: PreviewServer[] = [];
const png = usablePng(10, 20);
const context = {
	app: null,
	orientation: "portrait",
	generation: 1,
	changedDuringCapture: false,
	before: { status: "ok" as const, capturedAt: 1, value: {} },
	after: { status: "ok" as const, capturedAt: 2, value: {} },
};

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => server.stop()));
});

function actionResult(device: string) {
	return {
		device,
		dispatch: { status: "accepted" as const, reason: "accepted" },
		verification: {
			status: "not_applicable" as const,
			reason: "no verifier",
			observed: null,
		},
		resolved: [],
		accessibility: { status: "error" as const, capturedAt: 1, error: "unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	};
}

function commandStubs(
	overrides: Partial<NonNullable<TestServerOverrides["deviceCommands"]>> = {},
) {
	return {
		list: () => Effect.succeed({ devices: [], total: 0, offset: 0, limit: 0 }),
		memory: () => Effect.succeed({ totalBytes: 1, availableBytes: 1, runningSimulators: 0, processes: [] }),
		workspaces: () => Effect.succeed([]),
		observe: (device: string) => Effect.succeed({
			device,
			platform: "android" as const,
			startedAt: 1,
			completedAt: 2,
			observationId: null,
			captureId: null,
			accessibility: { status: "error" as const, capturedAt: 1, error: "unavailable" },
			image: { status: "error" as const, capturedAt: 1, error: "unavailable" },
			context,
			view: null,
			warnings: [],
		}),
		screenshot: (device: string) => Effect.succeed({
			device,
			platform: "android" as const,
			startedAt: 1,
			completedAt: 2,
			observationId: null,
			captureId: "c1",
			image: { status: "error" as const, capturedAt: 1, error: "unavailable" },
			context,
			warnings: [],
		}),
		find: (device: string, query: string) => Effect.succeed({ device, snapshot: "s1", query, nodes: [] }),
		act: (device: string) => Effect.succeed(actionResult(device)),
		operation: () => Effect.die("not used"),
		mutate: () => {},
		start: (device: string) => Effect.succeed({ device }),
		shutdown: () => Effect.void,
		...overrides,
	};
}

async function startServer(
	commands: NonNullable<TestServerOverrides["deviceCommands"]>,
	basePath = "/",
) {
	const started = await startTestServer({ deviceCommands: commands, basePath });
	servers.push(started.server);
	return started.origin;
}

describe("device command routes", () => {
	test("mounts status and command routes at the configured base path", async () => {
		const workspaces = [{ device: "android:emulator-5554" }];
		const origin = await startServer(commandStubs({
			workspaces: () => Effect.succeed(workspaces as never),
		}), "/workspace/phone");
		const [status, capabilities] = await Promise.all([
			fetch(`${origin}/workspace/phone/status`),
			fetch(`${origin}/workspace/phone/capabilities`),
		]);
		expect(status.status).toBe(200);
		expect(await status.json()).toEqual({ pid: process.pid, workspaces });
		expect(capabilities.status).toBe(200);
	});

	test("rejects malformed and oversized actions before dispatch", async () => {
		let calls = 0;
		const origin = await startServer(commandStubs({
			act: () => Effect.sync(() => {
				calls += 1;
				return actionResult("ios-device");
			}),
		}));
		for (const body of [
			"{",
			"{}",
			JSON.stringify({ actions: "tap" }),
			JSON.stringify({ actions: [], extra: "x".repeat(1024 * 1024) }),
		]) {
			const response = await fetch(`${origin}/device/ios-device/act`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body,
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ type: "InvalidCommandInput" });
		}
		expect(calls).toBe(0);
	});

	test("cancels route work when the HTTP request is canceled", async () => {
		const started = Promise.withResolvers<void>();
		const interrupted = Promise.withResolvers<void>();
		const origin = await startServer(commandStubs({
			act: () => Effect.sync(started.resolve).pipe(
				Effect.andThen(Effect.never),
				Effect.onInterrupt(() => Effect.sync(interrupted.resolve)),
			),
		}));
		const controller = new AbortController();
		const request = fetch(`${origin}/device/ios-device/act`, {
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

	test("runs one observe-to-act workflow through the common service", async () => {
		let frames = 0;
		const service = makeDeviceService(
			{ memoryReport: async () => ({ ok: false }), page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }) },
			{ start: async (device) => ({ error: null, device }), shutdown: async () => null, states: async () => [] },
			() => Effect.succeed({
				platform: "android" as const,
				dispatchInputFrame: async () => { frames += 1; },
				captureScreenshot: async () => ({ bytes: png, mimeType: "image/png", capturedAt: 2, width: 10, height: 20 }),
				readConfig: async () => ({ width: 1080, height: 2400, orientation: "portrait" }),
				readAccessibility: async () => androidSignInSnapshot,
				performField: async () => null,
				readFocusedField: async () => null,
			}),
			() => Effect.succeed("com.example.app"),
		);
		const origin = await startServer(service);
		const client = new ApplicationCommandClient({ origin });
		const observed = await client.observeDevice("android:emulator-5554") as {
			view: { nodes: Array<{ children: Array<{ children: Array<{ ref: string; label: string }> }> }> };
		};
		const ref = observed.view.nodes[0]!.children[0]!.children.find((node) => node.label === "Sign in")!.ref;
		const acted = await client.actDevice("android:emulator-5554", [{ type: "tap", target: `@${ref}` }]) as {
			dispatch: { status: string };
			resolved: Array<{ from?: { ref?: string } }>;
		};
		expect(acted.dispatch.status).toBe("accepted");
		expect(acted.resolved[0]?.from?.ref).toBe(ref);
		expect(frames).toBeGreaterThan(0);
	});

	test("translates lifecycle failures across the HTTP seam", async () => {
		const service = makeDeviceService(
			{ memoryReport: async () => ({ ok: false }), page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }) },
			{
				start: async () => ({ error: "Cannot start" }),
				shutdown: async () => "Cannot stop",
				states: async () => [],
			},
			() => Effect.die("A session is not used by this test"),
		);
		const client = new ApplicationCommandClient({ origin: await startServer(service) });

		await expect(client.startDevice("bad")).rejects.toMatchObject({
			message: "Cannot start",
		});
		await expect(client.shutdownDevice("bad")).rejects.toMatchObject({
			message: "Cannot stop",
		});
	});

	test("preserves image bytes and tagged command errors across HTTP", async () => {
		const details = {
			device: "ios-device",
			currentDeviceIds: ["other-ios-device"],
			recovery: "Select a current device, then run the command again.",
		};
		let fail = false;
		const origin = await startServer(commandStubs({
			screenshot: (device) => Effect.succeed({
				device,
				platform: "ios" as const,
				startedAt: 1,
				completedAt: 2,
				observationId: null,
				captureId: "c7",
				image: { status: "ok" as const, capturedAt: 2, value: {
					bytes: png, mimeType: "image/png", width: 10, height: 20,
					captureId: "c7", observationId: null,
				} },
				context,
				warnings: [],
			}),
			act: () => fail
				? Effect.fail(new DeviceGone({
					message: "Device ios-device is no longer available.",
					effect: "unknown",
					code: "device_gone",
					details,
				}))
				: Effect.succeed(actionResult("ios-device")),
		}));
		const client = new ApplicationCommandClient({ origin });
		const screenshot = await client.screenshotDevice("ios-device") as {
			image: { status: "ok"; value: { bytes: Buffer } };
		};
		expect(screenshot.image.value.bytes).toEqual(png);
		fail = true;
		const error = await client.actDevice("ios-device", []).catch((cause) => cause);
		expect(error).toBeInstanceOf(CommandRequestError);
		expect(error).toMatchObject({ code: "device_gone", effect: "unknown", details });
	});

	test("forwards screenshot requests for app launch and stop", async () => {
		const calls: unknown[] = [];
		const commands = commandStubs({
			operation: (device, operation, verification, options) => operation.pipe(
				Effect.tap(() => Effect.sync(() => calls.push({ device, verification, options }))),
				Effect.as(actionResult(device)),
			),
		});
		const started = await startTestServer({
			deviceCommands: commands,
			apps: { execute: () => Effect.void },
		});
		servers.push(started.server);
		const client = new ApplicationCommandClient({ origin: started.origin });
		for (const operation of ["launch", "stop"])
			await client.app("ios-device", operation, "com.example.app", { screenshot: true });
		expect(calls).toEqual([
			{
				device: "ios-device",
				verification: { kind: "foreground_app", operation: "launch", expected: "com.example.app" },
				options: { screenshot: true },
			},
			{
				device: "ios-device",
				verification: { kind: "foreground_app", operation: "stop", expected: "com.example.app" },
				options: { screenshot: true },
			},
		]);
	});
});
