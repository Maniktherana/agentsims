import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ApplicationCommandClient } from "../../cli/application-command-client";
import {
	AndroidSession,
	type AndroidSessionsService,
} from "../../core/android/session/session";
import { makeDeviceService } from "../../core/tools/devices/devices";
import type { DeviceState } from "../../core/tools/devices/state";
import { createAxStreamerCache } from "../../core/tools/observe/accessibility";
import { createSnapshotStore } from "../../core/tools/observe/snapshot-store";
import { encodeWsMessage } from "../../web/simulator/stream/ws-send-queue";
import { androidSignInSnapshot } from "../fixtures/ax-view-snapshots";
import { usablePng } from "../fixtures/capture-images";
import { startTestServer } from "../helpers/server";

const DEVICE_A = "android:R5CW1234ABC";
const DEVICE_B = "android:R5CW5678DEF";
const SERIAL_A = "R5CW1234ABC";
const SCREEN = { width: 1080, height: 2400, orientation: "portrait" };
const PNG = usablePng(SCREEN.width, SCREEN.height);

function state(device: string, port: number): DeviceState {
	return {
		pid: 100 + port,
		port,
		device,
		url: `http://127.0.0.1:${port}`,
		streamUrl: `http://127.0.0.1:${port}/stream`,
		wsUrl: `ws://127.0.0.1:${port}/ws`,
	};
}

function refFor(view: { refs: Record<string, string> }, id: string): string {
	const ref = Object.entries(view.refs).find(([, value]) => value === id)?.[0];
	if (!ref) throw new Error(`No ref for ${id}`);
	return ref;
}

function openSocket(url: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.binaryType = "arraybuffer";
		socket.onopen = () => resolve(socket);
		socket.onerror = () => reject(new Error("WebSocket did not open"));
	});
}

describe("browser and CLI coexistence", () => {
	test("raw AX and direct browser input remain available while CLI provenance stays device-scoped", async () => {
		const store = createSnapshotStore();
		const perceptionEntered = Promise.withResolvers<void>();
		const releasePerception = Promise.withResolvers<void>();
		let blockPerception = false;
		let perceptionDone = false;
		let browserMutations = 0;
		const browserMutation = Promise.withResolvers<void>();
		const readModes: string[] = [];
		const commandService = makeDeviceService(
			{
				memoryReport: async () => ({ ok: false }),
				page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
			},
			{
				start: async (device) => ({ error: null, device }),
				shutdown: async () => null,
				states: async () => [],
			},
			(device) =>
				Effect.succeed({
					platform: "android" as const,
					dispatchInputFrame: async () => {},
					captureScreenshot: async () => ({
						bytes: PNG,
						mimeType: "image/png",
						capturedAt: Date.now(),
						width: SCREEN.width,
						height: SCREEN.height,
					}),
					readConfig: async () => SCREEN,
					readAccessibility: async () => {
						if (device === DEVICE_A && blockPerception) {
							blockPerception = false;
							perceptionEntered.resolve();
							await releasePerception.promise;
						}
						return androidSignInSnapshot;
					},
				}),
			() => Effect.succeed("com.example.app"),
			store,
		);
		const browserSession = new AndroidSession(SERIAL_A, {
			readScreenConfig: async () => ({ ...SCREEN, rotation: 0 }),
			warmAx: async () => {},
			readAx: async (_serial, mode) => {
				readModes.push(mode);
				return androidSignInSnapshot;
			},
			touchDevice: async () => {},
			markUiMutation: () => {
				browserMutations += 1;
				commandService.mutate(DEVICE_A);
				browserMutation.resolve();
			},
		});
		await browserSession.start();
		const androidSessions: AndroidSessionsService = {
			get: (serial) =>
				serial === SERIAL_A
					? Effect.succeed(browserSession)
					: Effect.die(`Unexpected Android serial: ${serial}`),
			close: () => Effect.void,
		};
		const started = await startTestServer({
			deviceCommands: commandService,
			androidSessions,
		});
		const client = new ApplicationCommandClient({ origin: started.origin });
		let socket: WebSocket | null = null;
		try {
			const beforeA = (await client.observeDevice(DEVICE_A)) as {
				captureId: string;
				view: { refs: Record<string, string> };
			};
			const beforeB = (await client.observeDevice(DEVICE_B)) as {
				captureId: string;
				view: { refs: Record<string, string> };
			};
			const refA = refFor(beforeA.view, "autoplay");
			const refB = refFor(beforeB.view, "autoplay");

			const raw = await fetch(
				`${started.origin}/helper/${encodeURIComponent(DEVICE_A)}/ax?mode=fresh`,
			);
			expect(raw.status).toBe(200);
			expect(await raw.json()).toEqual(androidSignInSnapshot);
			expect(readModes).toEqual(["fresh"]);

			blockPerception = true;
			const perception = client.observeDevice(DEVICE_A).then((result) => {
				perceptionDone = true;
				return result;
			});
			await perceptionEntered.promise;

			socket = await openSocket(
				`${started.origin.replace(/^http/, "ws")}/helper/${encodeURIComponent(DEVICE_A)}/ws`,
			);
			socket.send(new Uint8Array([0x03, 0x7b]));
			socket.send(
				encodeWsMessage(0x03, { type: "begin", x: 0.25, y: 0.75 }),
			);
			await browserMutation.promise;

			expect(browserMutations).toBe(1);
			expect(perceptionDone).toBe(false);
			expect(store.resolveRef(DEVICE_A, refA)).toMatchObject({
				ok: false,
				reason: "unknown",
			});
			expect(store.resolveCapture(DEVICE_A, beforeA.captureId)).toEqual({
				ok: false,
				reason: "stale",
			});
			expect(store.resolveRef(DEVICE_B, refB).ok).toBe(true);
			expect(store.resolveCapture(DEVICE_B, beforeB.captureId).ok).toBe(true);

			releasePerception.resolve();
			expect(await perception).toMatchObject({
				accessibility: { status: "error" },
				view: null,
			});
		} finally {
			socket?.close();
			await started.server.stop();
			await browserSession.close();
		}
	});

	test("browser AX work stays bounded while CLI work runs independently", async () => {
		const firstStreamCapture = Promise.withResolvers<void>();
		const releaseFirstStreamCapture = Promise.withResolvers<void>();
		const secondStreamCapture = Promise.withResolvers<void>();
		let streamCaptures = 0;
		const streamers = createAxStreamerCache({
			androidChangeMinIntervalMs: 0,
			collect: async () => {
				streamCaptures += 1;
				if (streamCaptures === 1) {
					firstStreamCapture.resolve();
					await releaseFirstStreamCapture.promise;
				}
				if (streamCaptures === 2) secondStreamCapture.resolve();
				return androidSignInSnapshot;
			},
		});
		const blockedDispatch = Promise.withResolvers<void>();
		const releaseDispatch = Promise.withResolvers<void>();
		let blockNextDeviceAAction = false;
		let deviceAActionDone = false;
		const commandService = makeDeviceService(
			{
				memoryReport: async () => ({ ok: false }),
				page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
			},
			{
				start: async (device) => ({ error: null, device }),
				shutdown: async () => null,
				states: async () => [],
			},
			(device) =>
				Effect.succeed({
					platform: "android" as const,
					dispatchInputFrame: async () => {
						if (device === DEVICE_A && blockNextDeviceAAction) {
							blockNextDeviceAAction = false;
							blockedDispatch.resolve();
							await releaseDispatch.promise;
						}
					},
					captureScreenshot: async () => ({
						bytes: PNG,
						mimeType: "image/png",
						capturedAt: Date.now(),
						width: SCREEN.width,
						height: SCREEN.height,
					}),
					readConfig: async () => SCREEN,
					readAccessibility: async () => androidSignInSnapshot,
				}),
			() => Effect.succeed("com.example.app"),
		);
		const started = await startTestServer({
			basePath: "/.sim",
			deviceCommands: commandService,
			axStreamers: streamers,
			readDeviceStates: async () => [
				state(DEVICE_A, 3100),
				state(DEVICE_B, 3101),
			],
		});
		const client = new ApplicationCommandClient({
			origin: `${started.origin}/.sim`,
		});
		let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
		try {
			const stream = await fetch(
				`${started.origin}/.sim/ax?device=${encodeURIComponent(DEVICE_A)}`,
			);
			expect(stream.status).toBe(200);
			reader = stream.body!.getReader();
			await reader.read();
			await firstStreamCapture.promise;

			const observed = (await client.observeDevice(DEVICE_A)) as {
				view: { id: string };
			};
			const acted = (await client.actDevice(DEVICE_A, [
				{ type: "button", button: "back" },
			])) as { dispatch: { status: string } };
			expect(observed.view.id).toBe("s1");
			expect(acted.dispatch.status).toBe("accepted");

			const refreshes = await Promise.all(
				Array.from({ length: 5 }, () =>
					fetch(
						`${started.origin}/.sim/ax/refresh?device=${encodeURIComponent(DEVICE_A)}`,
						{ method: "POST" },
					),
				),
			);
			expect(refreshes.map((response) => response.status)).toEqual([
				202, 202, 202, 202, 202,
			]);
			expect(streamCaptures).toBe(1);
			releaseFirstStreamCapture.resolve();
			await secondStreamCapture.promise;
			expect(streamCaptures).toBe(2);

			blockNextDeviceAAction = true;
			const deviceAAction = client
				.actDevice(DEVICE_A, [{ type: "button", button: "home" }])
				.then((result) => {
					deviceAActionDone = true;
					return result;
				});
			await blockedDispatch.promise;
			const deviceBAction = (await client.actDevice(DEVICE_B, [
				{ type: "button", button: "home" },
			])) as { dispatch: { status: string } };
			expect(deviceBAction.dispatch.status).toBe("accepted");
			expect(deviceAActionDone).toBe(false);
			releaseDispatch.resolve();
			expect(
				(await deviceAAction as { dispatch: { status: string } }).dispatch.status,
			).toBe("accepted");
		} finally {
			releaseFirstStreamCapture.resolve();
			releaseDispatch.resolve();
			await reader?.cancel();
			streamers.dispose();
			await started.server.stop();
		}
	});
});
