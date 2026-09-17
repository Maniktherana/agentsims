import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { androidSignInSnapshot } from "../../../fixtures/ax-view-snapshots";
import { makeDeviceService } from "../../../../core/tools/devices/devices";
import {
	CommandFailure,
	DeviceGone,
	InvalidCommandInput,
} from "../../../../core/tools/errors";

const selected = "android:emulator-5554";
const survivor = "android:emulator-5556";
const missing = "adb: device 'emulator-5554' not found";

function service(
	resolveSession: Parameters<typeof makeDeviceService>[2],
	states: () => Promise<Array<{ device: string }>>,
) {
	return makeDeviceService(
		{
			page: async () => ({ devices: [], total: 0, offset: 0, limit: 0 }),
			memoryReport: async () => ({ ok: true }),
		},
		{
			start: async (device) => ({ error: null, device }),
			shutdown: async () => null,
			states: states as never,
		},
		resolveSession,
	);
}

function session(input: {
	dispatch?: () => Promise<void>;
	accessibility?: () => Promise<unknown>;
}) {
	return {
		platform: "android" as const,
		dispatchInputFrame: input.dispatch ?? (async () => {}),
		captureScreenshot: async () => {
			throw new Error("not used");
		},
		readConfig: async () => ({ width: 1080, height: 2400 }),
		readAccessibility:
			input.accessibility ?? (async () => androidSignInSnapshot),
		performField: async () => {
			throw new Error("not used");
		},
		readFocusedField: async () => null,
	};
}

async function rejected(
	effect: Effect.Effect<unknown, unknown>,
): Promise<unknown> {
	return Effect.runPromise(Effect.flip(effect));
}

describe("selected device loss", () => {
	test("keeps an invalid device ID separate before dispatch", async () => {
		let refreshes = 0;
		const commands = service(
			() =>
				Effect.fail(
					new InvalidCommandInput({ message: "Invalid or missing device" }),
				),
			async () => {
				refreshes += 1;
				return [];
			},
		);

		const error = await rejected(
			commands.act("", [{ type: "button", button: "home" }]),
		);

		expect(error).toBeInstanceOf(InvalidCommandInput);
		expect(error).not.toBeInstanceOf(DeviceGone);
		expect(refreshes).toBe(0);
	});

	test("reports disappearance before dispatch with the current device IDs", async () => {
		let refreshes = 0;
		const commands = service(
			() => Effect.fail(new CommandFailure({ message: missing })),
			async () => {
				refreshes += 1;
				return [{ device: selected }, { device: survivor }];
			},
		);

		const error = (await rejected(
			commands.act(selected, [{ type: "button", button: "home" }]),
		)) as DeviceGone;

		expect(error).toBeInstanceOf(DeviceGone);
		expect(error.code).toBe("device_gone");
		expect(error.effect).toBe("none");
		expect(error.details).toEqual({
			device: selected,
			currentDeviceIds: [survivor],
			recovery: "Select a current device, then run the command again.",
		});
		expect(refreshes).toBe(1);
	});

	test("keeps dispatch unknown when the device disappears during dispatch", async () => {
		const commands = service(
			() =>
				Effect.succeed(
					session({
						dispatch: async () => {
							throw new Error(missing);
						},
					}) as never,
				),
			async () => [{ device: survivor }],
		);

		const error = (await rejected(
			commands.act(selected, [{ type: "button", button: "home" }]),
		)) as DeviceGone;

		expect(error).toBeInstanceOf(DeviceGone);
		expect(error.effect).toBe("unknown");
	});

	test("keeps dispatch unknown when the device disappears during the post-action read", async () => {
		let dispatched = false;
		const commands = service(
			() =>
				Effect.succeed(
					session({
						dispatch: async () => {
							dispatched = true;
						},
						accessibility: async () => {
							if (dispatched) throw new Error(missing);
							return androidSignInSnapshot;
						},
					}) as never,
				),
			async () => [{ device: survivor }],
		);

		const error = (await rejected(
			commands.act(selected, [{ type: "button", button: "home" }]),
		)) as DeviceGone;

		expect(error).toBeInstanceOf(DeviceGone);
		expect(error.effect).toBe("unknown");
	});

	test("does not call a transient accessibility failure device loss", async () => {
		let refreshes = 0;
		const commands = service(
			() =>
				Effect.succeed(
					session({
						accessibility: async () => {
							throw new Error("Accessibility read timed out");
						},
					}) as never,
				),
			async () => {
				refreshes += 1;
				return [{ device: survivor }];
			},
		);

		const result = await Effect.runPromise(
			commands.act(selected, [{ type: "button", button: "home" }]),
		);

		expect(result.dispatch.status).toBe("accepted");
		expect(result.accessibility).toMatchObject({
			status: "error",
			error: "Accessibility read timed out",
		});
		expect(refreshes).toBe(0);
	});
});
