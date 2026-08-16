import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { MediaCommands } from "../../../commands/media-commands";

describe("MediaCommands", () => {
	test("delegates reads and writes without HTTP concerns", async () => {
		const calls: unknown[] = [];
		const state = { device: "ios-device", sections: [] } as never;
		const commands = new MediaCommands({
			async read(device) {
				calls.push({ read: device });
				return state;
			},
			async apply(device, action, publicPort) {
				calls.push({ apply: { device, action, publicPort } });
				return { ok: true, apply: "live" };
			},
		});

		expect(await Effect.runPromise(commands.read("ios-device"))).toBe(state);
		expect(
			await Effect.runPromise(
				commands.apply(
					"android:emulator-5554",
					{ action: "android-host-microphone", enabled: true },
					3200,
				),
			),
		).toEqual({ ok: true, apply: "live" });
		expect(calls).toEqual([
			{ read: "ios-device" },
			{
				apply: {
					device: "android:emulator-5554",
					action: { action: "android-host-microphone", enabled: true },
					publicPort: 3200,
				},
			},
		]);
	});
});
