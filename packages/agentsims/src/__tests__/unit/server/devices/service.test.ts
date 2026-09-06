import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { makeDeviceService } from "../../../../server/devices/service";

const row = {
	device: "android:emulator-5554",
	name: "Pixel 10",
	runtime: "Android-17",
	state: "Booted",
	chrome: null,
	placeholderAsset: null,
	helper: null,
};

describe("makeDeviceService", () => {
	test("uses the catalog and lifecycle services", async () => {
		const calls: string[] = [];
		const commands = makeDeviceService(
			{
				memoryReport: async () => ({ ok: false }),
				page: async () => ({
					devices: [row],
					total: 1,
					offset: 0,
					limit: 1,
				}),
			},
			{
				start: async (device) => {
					calls.push(`start:${device}`);
					return { error: null, device };
				},
				shutdown: async (device) => {
					calls.push(`shutdown:${device}`);
					return null;
				},
				states: async () => [],
			},
			() => Effect.die("A session is not used by this test"),
		);

		expect((await Effect.runPromise(commands.list())).devices).toEqual([row]);
		expect(
			await Effect.runPromise(commands.start(row.device, { port: 3200 })),
		).toEqual({
			device: row.device,
		});
		await Effect.runPromise(commands.shutdown(row.device));
		expect(calls).toEqual([`start:${row.device}`, `shutdown:${row.device}`]);
	});

	test("converts lifecycle errors to command errors", async () => {
		const commands = makeDeviceService(
			{
				memoryReport: async () => ({ ok: false }),
				page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
			},
			{
				start: async () => ({ error: "Cannot start" }),
				shutdown: async () => "Cannot stop",
				states: async () => [],
			},
			() => Effect.die("A session is not used by this test"),
		);
		await expect(
			Effect.runPromise(commands.start("bad", { port: 3200 })),
		).rejects.toThrow("Cannot start");
		await expect(Effect.runPromise(commands.shutdown("bad"))).rejects.toThrow(
			"Cannot stop",
		);
	});

	test("uses the target session for both observation and input", async () => {
		const actions: unknown[] = [];
		const observations: string[] = [];
		const workspaces = [
			{
				device: row.device,
				pid: 42,
				port: 3200,
				url: "http://127.0.0.1:3200",
				streamUrl: "http://127.0.0.1:3200/stream",
				wsUrl: "ws://127.0.0.1:3200/ws",
			},
		];
		const commands = makeDeviceService(
			{
				memoryReport: async () => ({ ok: false }),
				page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
			},
			{
				start: async (device) => ({ error: null, device }),
				shutdown: async () => null,
				states: async () => workspaces,
			},
			(device) =>
				Effect.succeed({
					platform: "android" as const,
					mimeType: "image/png",
					dispatchInputFrame: async (data: Buffer) => {
						actions.push({
							device,
							tag: data[0],
							input: JSON.parse(data.subarray(1).toString()),
						});
					},
					captureScreenshot: async () => Buffer.from("png"),
					readConfig: async () => ({}),
					readAccessibility: async () => {
						observations.push(device);
						return null;
					},
				}),
		);

		expect(await Effect.runPromise(commands.workspaces())).toEqual(workspaces);
		expect(await Effect.runPromise(commands.observe(row.device))).toMatchObject(
			{ device: row.device },
		);
		await Effect.runPromise(
			commands.act(row.device, [{ type: "button", button: "home" }]),
		);
		expect(observations).toEqual([row.device]);
		expect(actions).toEqual([
			{
				device: row.device,
				tag: 4,
				input: { button: "home" },
			},
		]);
	});
});
