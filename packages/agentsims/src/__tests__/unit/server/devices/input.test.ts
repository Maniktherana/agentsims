import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import {
	decodeDeviceAction,
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
