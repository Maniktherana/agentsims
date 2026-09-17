import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import {
	ANDROID_DEVICE_BUTTONS,
	decodeDeviceAction,
	IOS_DEVICE_BUTTONS,
	makeDeviceActions,
	parseDeviceAction,
} from "../../../../core/tools/input";

function decodedFrame(data: Buffer): {
	tag: number;
	payload: Record<string, unknown>;
} {
	return {
		tag: data[0]!,
		payload: JSON.parse(data.subarray(1).toString("utf8")),
	};
}

describe("makeDeviceActions", () => {
	test("paces a swipe on the server and dispatches ordered input", async () => {
		const frames: Buffer[] = [];
		const delays: number[] = [];
		const act = makeDeviceActions(
			() =>
				Effect.succeed({
					dispatchInputFrame: async (data) => {
						frames.push(data);
					},
				}),
			(milliseconds) =>
				Effect.sync(() => {
					delays.push(milliseconds);
				}),
		);

		await Effect.runPromise(
			act("android:emulator-5554", [
				{
					type: "swipe",
					x1: 0.5,
					y1: 0.8,
					x2: 0.5,
					y2: 0.2,
					durationMs: 240,
				},
			]),
		);

		expect(frames.map(decodedFrame)).toEqual([
			{ tag: 0x03, payload: { type: "begin", x: 0.5, y: 0.8 } },
			{ tag: 0x03, payload: { type: "move", x: 0.5, y: 0.2 } },
			{ tag: 0x03, payload: { type: "end", x: 0.5, y: 0.2 } },
		]);
		expect(delays).toEqual([120, 120]);
	});

	test("rejects the whole batch before it dispatches an invalid action", async () => {
		const frames: Buffer[] = [];
		const act = makeDeviceActions(() =>
			Effect.succeed({
				dispatchInputFrame: async (data) => {
					frames.push(data);
				},
			}),
		);

		await expect(
			Effect.runPromise(
				act("ios-device", [
					{ type: "tap", x: 0.5, y: 0.5 },
					{ type: "tap", x: 2, y: 0.5 },
				]),
			),
		).rejects.toThrow("x must be a number between 0 and 1");
		expect(frames).toHaveLength(0);
	});

	test("a refused batch reports none, and a lost frame reports unknown", async () => {
		const refused = makeDeviceActions(() =>
			Effect.succeed({ dispatchInputFrame: async () => {} }),
		);
		const rejection = await Effect.runPromise(
			Effect.flip(refused("ios-device", [{ type: "tap", x: 2, y: 0.5 }])),
		);
		expect(rejection.effect).toBe("none");

		const lost = makeDeviceActions(() =>
			Effect.succeed({
				dispatchInputFrame: async () => {
					throw new Error("the device connection closed");
				},
			}),
		);
		const loss = await Effect.runPromise(
			Effect.flip(lost("ios-device", [{ type: "button", button: "home" }])),
		);
		expect(loss.effect).toBe("unknown");
		expect(loss.message).toBe("the device connection closed");
	});

	test("a character the keyboard cannot send stops the batch before dispatch", async () => {
		const frames: Buffer[] = [];
		const act = makeDeviceActions(() =>
			Effect.succeed({
				dispatchInputFrame: async (data) => {
					frames.push(data);
				},
			}),
		);

		const rejection = await Effect.runPromise(
			Effect.flip(
				act("ios-device", [
					{ type: "button", button: "home" },
					{ type: "type", text: "caf\u00e9" },
				]),
			),
		);

		expect(rejection.effect).toBe("none");
		expect(frames).toHaveLength(0);
	});

	test("the accepted actions come back to the caller", async () => {
		const act = makeDeviceActions(() =>
			Effect.succeed({ dispatchInputFrame: async () => {} }),
		);

		expect(
			await Effect.runPromise(
				act("android:emulator-5554", [
					{ type: "button", button: "back" },
					{ type: "rotate", orientation: "portrait" },
				]),
			),
		).toEqual([
			{ type: "button", button: "back" },
			{ type: "rotate", orientation: "portrait" },
		]);
	});

	test("maps every supported button to its platform input", async () => {
		const frames: Array<{
			device: string;
			tag: number;
			payload: Record<string, unknown>;
		}> = [];
		const act = makeDeviceActions((device) =>
			Effect.succeed({
				dispatchInputFrame: async (data) => {
					frames.push({ device, ...decodedFrame(data) });
				},
			}),
		);

		await Effect.runPromise(
			act(
				"android:emulator-5554",
				ANDROID_DEVICE_BUTTONS.map((button) => ({ type: "button", button })),
			),
		);
		await Effect.runPromise(
			act(
				"ios-device",
				IOS_DEVICE_BUTTONS.map((button) => ({ type: "button", button })),
			),
		);

		expect(frames).toEqual([
			{ device: "android:emulator-5554", tag: 0x04, payload: { button: "home" } },
			{ device: "android:emulator-5554", tag: 0x04, payload: { button: "power" } },
			{
				device: "android:emulator-5554",
				tag: 0x04,
				payload: { button: "volume_up" },
			},
			{
				device: "android:emulator-5554",
				tag: 0x04,
				payload: { button: "volume_down" },
			},
			{ device: "android:emulator-5554", tag: 0x04, payload: { button: "back" } },
			{
				device: "android:emulator-5554",
				tag: 0x04,
				payload: { button: "app_switch" },
			},
			{ device: "ios-device", tag: 0x04, payload: { button: "home" } },
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "power", page: 12, usage: 48 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "volume_up", page: 12, usage: 233 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "volume_down", page: 12, usage: 234 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "app_switcher" },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "action", page: 11, usage: 45 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "side_button", page: 12, usage: 149 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "digital_crown", page: 12, usage: 64 },
			},
			{
				device: "ios-device",
				tag: 0x04,
				payload: { button: "left_side_button", page: 65281, usage: 512 },
			},
		]);
	});

	test("rejects every button from the other platform before it gets a session", async () => {
		let sessionRequests = 0;
		const act = makeDeviceActions(() => {
			sessionRequests += 1;
			return Effect.succeed({ dispatchInputFrame: async () => {} });
		});
		const androidButtons = new Set<string>(ANDROID_DEVICE_BUTTONS);
		const iosButtons = new Set<string>(IOS_DEVICE_BUTTONS);
		const cases = [
			{
				device: "android:emulator-5554",
				buttons: IOS_DEVICE_BUTTONS.filter(
					(button) => !androidButtons.has(button),
				),
				platform: "Android",
			},
			{
				device: "ios-device",
				buttons: ANDROID_DEVICE_BUTTONS.filter(
					(button) => !iosButtons.has(button),
				),
				platform: "iOS",
			},
		];

		for (const { device, buttons, platform } of cases) {
			for (const button of buttons) {
				const error = await Effect.runPromise(
					Effect.flip(act(device, [{ type: "button", button }])),
				);
				expect(error.effect).toBe("none");
				expect(error.message).toContain(
					`Button "${button}" is not available on ${platform}.`,
				);
			}
		}
		expect(sessionRequests).toBe(0);
	});

	test("parses supported actions and bounds swipe duration", () => {
		expect(
			parseDeviceAction('{"type":"rotate","orientation":"landscape_left"}'),
		).toEqual({
			type: "rotate",
			orientation: "landscape_left",
		});
		expect(
			decodeDeviceAction({
				type: "swipe",
				x1: 0,
				y1: 0,
				x2: 1,
				y2: 1,
				durationMs: 60_000,
			}),
		).toMatchObject({ durationMs: 5_000 });
		expect(parseDeviceAction('{"type":"button","button":"volume-up"}')).toEqual(
			{ type: "button", button: "volume-up" },
		);
		expect(() =>
			parseDeviceAction('{"type":"button","button":"volume-louder"}'),
		).toThrow();
	});
});

test("interrupting an action cancels pending session acquisition", async () => {
	let entered!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let cancelled = false;
	const act = makeDeviceActions(() =>
		Effect.async(() => {
			entered();
			return Effect.sync(() => {
				cancelled = true;
			});
		}),
	);
	const fiber = Effect.runFork(
		act("android:emulator-5554", [{ type: "tap", x: 0.5, y: 0.5 }]),
	);
	await started;
	await Effect.runPromise(Fiber.interrupt(fiber));
	expect(cancelled).toBe(true);
});
