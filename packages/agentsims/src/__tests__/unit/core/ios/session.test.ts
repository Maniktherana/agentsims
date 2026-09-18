import { expect, spyOn, test } from "bun:test";
import { Effect } from "effect";
import {
	DeviceSession,
	IosSessions,
	IosSessionsUnavailable,
	type DeviceSessionDependencies,
	type HidSocket,
} from "../../../../core/ios/session";
import type { AvccFrame, MjpegFrame } from "../../../../core/ios/stream/native";
import {
	NativeHid,
	type SimHIDHandle,
} from "../../../../core/ios/stream/native";
import { iosAxSnapshot } from "../../../../core/ios/accessibility";
import { makeDeviceActions } from "../../../../core/tools/input";

function frame(tag: number, payload: unknown): Buffer {
	return Buffer.concat([
		Buffer.from([tag]),
		Buffer.from(JSON.stringify(payload), "utf8"),
	]);
}

type TestHid = NonNullable<DeviceSessionDependencies["hid"]>;

function testHid(overrides: Partial<TestHid> = {}): TestHid {
	return {
		touch: async () => {},
		button: async () => {},
		buttonHid: async () => {},
		multiTouch: async () => {},
		key: async () => {},
		orientation: async () => true,
		caDebug: async () => true,
		memoryWarning: async () => {},
		digitalCrown: async () => {},
		scroll: async () => {},
		softwareKeyboard: async () => {},
		stop: async () => {},
		...overrides,
	};
}

class ControlledCapture {
	private mjpeg: ((frame: MjpegFrame) => Promise<void>) | null = null;

	async start(): Promise<void> {}
	async stop(): Promise<void> {}
	async subscribeMjpeg(
		onFrame: (frame: MjpegFrame) => Promise<void>,
	): Promise<() => void> {
		this.mjpeg = onFrame;
		return () => {
			this.mjpeg = null;
		};
	}
	async subscribeAvcc(
		_onFrame: (frame: AvccFrame) => Promise<void>,
	): Promise<() => void> {
		return () => {};
	}
	async emit(data: string, width: number, height: number): Promise<void> {
		if (!this.mjpeg) throw new Error("capture is not started");
		await this.mjpeg({ data: Buffer.from(data), width, height });
	}
}

function sessionWith(
	hid: Partial<TestHid> = {},
	onMutation: (udid: string) => void = () => {},
	options: Pick<
		DeviceSessionDependencies,
		"describeAccessibility" | "screenshotWaitMs"
	> = {},
): { session: DeviceSession; capture: ControlledCapture } {
	const capture = new ControlledCapture();
	return {
		session: new DeviceSession("ios-device", onMutation, {
			hid: testHid(hid),
			capture,
			...options,
		}),
		capture,
	};
}

function nativeHid(overrides: Partial<SimHIDHandle>): NativeHid {
	const handle = testHid(overrides) as SimHIDHandle;
	return new NativeHid("ios-device", handle);
}

test("input dispatch resolves after native touch completes", async () => {
	const completion = Promise.withResolvers<void>();
	const mutations: string[] = [];
	const { session } = sessionWith(
		{
			touch: async () => completion.promise,
		},
		(udid) => mutations.push(udid),
	);

	let finished = false;
	const pending = session
		.dispatchInputFrame(frame(0x03, { type: "begin", x: 0.5, y: 0.5 }))
		.then(() => {
			finished = true;
		});
	await Promise.resolve();

	expect(finished).toBe(false);
	expect(mutations).toEqual(["ios-device"]);
	completion.resolve();
	await pending;
	expect(finished).toBe(true);
});

test("malformed native input does not publish a mutation", async () => {
	const mutations: string[] = [];
	const { session } = sessionWith({}, (udid) => mutations.push(udid));

	await session.dispatchInputFrame(Buffer.from([0x03, 0x7b]));

	expect(mutations).toEqual([]);
});

test("input dispatch resolves after native button completes", async () => {
	const completion = Promise.withResolvers<void>();
	const { session } = sessionWith({
		button: async () => completion.promise,
	});

	let finished = false;
	const pending = session
		.dispatchInputFrame(frame(0x04, { button: "back" }))
		.then(() => {
			finished = true;
		});
	await Promise.resolve();

	expect(finished).toBe(false);
	completion.resolve();
	await pending;
	expect(finished).toBe(true);
});

test("a native rejection reaches the command error", async () => {
	const failure = new Error("native button failed");
	const { session } = sessionWith({
		button: async () => {
			throw failure;
		},
	});
	const dispatch = makeDeviceActions(() =>
		Effect.succeed({
			dispatchInputFrame: (data: Buffer) => session.dispatchInputFrame(data),
		}),
	);

	const result = await Effect.runPromise(
		Effect.either(dispatch("ios:device", [{ type: "button", button: "home" }])),
	);

	expect(result).toMatchObject({
		_tag: "Left",
		left: {
			_tag: "CommandFailure",
			effect: "unknown",
			cause: failure,
		},
	});
});

test("the browser boundary contains invalid native input", async () => {
	const failure = new Error("invalid touch type");
	const { session } = sessionWith({
		touch: async () => {
			throw failure;
		},
	});
	let message: ((data: Buffer) => void) | undefined;
	const socket: HidSocket = {
		send: () => {},
		on: (event, callback) => {
			if (event === "message") message = callback;
		},
		close: () => {},
	};
	const error = spyOn(console, "error").mockImplementation(() => {});
	try {
		session.attachHidSocket(socket);
		expect(() => message?.(frame(0x03, { x: 0.5, y: 0.5 }))).not.toThrow();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(error).toHaveBeenCalledWith(
			"[agentsims:ios] browser input failed:",
			"invalid touch type",
		);
	} finally {
		error.mockRestore();
	}
});

test("a screenshot rejects a cached frame from before its request", async () => {
	const { session, capture } = sessionWith({}, () => {}, {
		screenshotWaitMs: 5,
	});
	await session.start();
	await capture.emit("old", 100, 200);

	await expect(session.captureScreenshot()).rejects.toThrow(
		"A newer iOS screenshot was not available within 5 ms",
	);
});

test("a screenshot reports unavailable when no frame arrives", async () => {
	const { session } = sessionWith({}, () => {}, { screenshotWaitMs: 5 });

	await expect(session.captureScreenshot()).rejects.toThrow(
		"A newer iOS screenshot was not available within 5 ms",
	);
});

test("a screenshot returns one complete frame from after its request", async () => {
	const now = spyOn(Date, "now").mockReturnValue(1_234);
	try {
		const { session, capture } = sessionWith();
		await session.start();
		await capture.emit("old", 100, 200);

		const pending = session.captureScreenshot();
		await Promise.resolve();
		await capture.emit("new-frame", 300, 400);
		const screenshot = await pending;

		expect(screenshot).toEqual({
			sequence: 2,
			width: 300,
			height: 400,
			bytes: Buffer.from("new-frame"),
			mimeType: "image/jpeg",
			capturedAt: 1_234,
		});

		await capture.emit("next", 500, 600);
		expect(screenshot.bytes).toEqual(Buffer.from("new-frame"));
	} finally {
		now.mockRestore();
	}
});

test("a screenshot after an action waits for a post-action frame", async () => {
	const completion = Promise.withResolvers<void>();
	const { session, capture } = sessionWith({
		button: async () => completion.promise,
	});
	await session.start();
	await capture.emit("old", 100, 200);

	const action = session.dispatchInputFrame(frame(0x04, { button: "home" }));
	await capture.emit("during-action", 100, 200);
	completion.resolve();
	await action;

	const pending = session.captureScreenshot();
	await Promise.resolve();
	await capture.emit("after-action", 100, 200);

	expect((await pending).bytes).toEqual(Buffer.from("after-action"));
});

test("focused text identity and selection come from native accessibility", async () => {
	const raw = JSON.stringify([
		{
			AXUniqueId: "root",
			AXLabel: null,
			AXValue: null,
			enabled: true,
			frame: { x: 0, y: 0, width: 100, height: 200 },
			role_description: "application",
			type: "Application",
			children: [
				{
					AXUniqueId: "email",
					AXLabel: "Email",
					AXValue: "hello",
					enabled: true,
					focused: true,
					selection: { start: 2, end: 4 },
					frame: { x: 10, y: 20, width: 80, height: 30 },
					role_description: "text field",
					type: "TextField",
					children: [],
				},
			],
		},
	]);
	const { session } = sessionWith({}, () => {}, {
		describeAccessibility: async () => raw,
	});

	expect(await session.readFocusedField()).toEqual({
		value: "hello",
		editable: true,
		password: false,
		focused: true,
		identity: { id: "email" },
		selection: { start: 2, end: 4 },
	});
});

test("focused readback stays coherent when the native traversal path changes", async () => {
	const field = {
		AXUniqueId: null,
		AXLabel: null,
		AXValue: "hello",
		enabled: true,
		focused: true,
		selection: { start: 5, end: 5 },
		frame: { x: 28, y: 808, width: 286, height: 28 },
		role_description: "search text field",
		type: "TextField",
		children: [],
	};
	const root = (children: unknown[]) => [
		{
			...field,
			type: "Application",
			role_description: "application",
			focused: false,
			frame: { x: 0, y: 0, width: 402, height: 874 },
			children,
		},
	];
	const raws = [
		root([{ ...field, type: "StaticText", focused: false }, field]),
		root([field]),
	];
	let reads = 0;
	const { session } = sessionWith({}, () => {}, {
		describeAccessibility: async () => JSON.stringify(raws[reads++] ?? raws[1]),
	});

	const first = await session.readAccessibility();
	const firstId = iosAxSnapshot(first).elements.at(-1)!.id;
	expect((await session.readFocusedField())?.identity).toEqual({ id: firstId });
	expect(reads).toBe(1);
	await session.dispatchInputFrame(frame(0x06, { type: "down", usage: 0x04 }));
	const second = await session.readAccessibility();
	expect(iosAxSnapshot(second).elements.at(-1)!.id).toBe(firstId);
	expect((await session.readFocusedField())?.identity).toEqual({ id: firstId });
	expect(reads).toBe(2);
});

test("focus acknowledgement uses bounded fresh native readback", async () => {
	let reads = 0;
	const focused = JSON.stringify([
		{
			AXUniqueId: null,
			AXLabel: null,
			AXValue: "",
			enabled: true,
			focused: true,
			frame: { x: 10, y: 20, width: 80, height: 30 },
			role_description: "text field",
			type: "TextField",
			children: [],
		},
	]);
	const { session } = sessionWith({}, () => {}, {
		describeAccessibility: async () => (++reads < 3 ? "[]" : focused),
	});

	expect(await session.readFocusedField()).toMatchObject({ focused: true });
	expect(reads).toBe(3);
});

test("NativeHid waits for its controlled native handle", async () => {
	const completion = Promise.withResolvers<void>();
	let started = false;
	const hid = nativeHid({
		touch: async () => {
			started = true;
			await completion.promise;
		},
	});
	let finished = false;
	const pending = hid.touch("begin", 0.5, 0.5, 100, 200).then(() => {
		finished = true;
	});
	await Promise.resolve();
	expect(started).toBe(true);
	expect(finished).toBe(false);
	completion.resolve();
	await pending;
	expect(finished).toBe(true);
});

test("NativeHid preserves a controlled native rejection", async () => {
	const failure = new Error("native button failed");
	const hid = nativeHid({
		button: async () => {
			throw failure;
		},
	});
	await expect(hid.button("back")).rejects.toBe(failure);
});

test("an Android-only host rejects iOS sessions without loading native capture", async () => {
	const result = await Effect.runPromise(
		Effect.gen(function* () {
			const sessions = yield* IosSessions;
			return yield* sessions.get("ios-device").pipe(Effect.flip);
		}).pipe(Effect.provide(IosSessionsUnavailable)),
	);
	expect(result._tag).toBe("IosHostUnavailable");
});

test("missing native focus fails closed", async () => {
	const { session } = sessionWith({}, () => {}, {
		describeAccessibility: async () => "[]",
	});
	expect(await session.readFocusedField()).toBeNull();
});

test("rotation refusal is reported after invalidation", async () => {
	const mutations: string[] = [];
	const { session } = sessionWith({ orientation: async () => false }, (udid) =>
		mutations.push(udid),
	);

	await expect(
		session.dispatchInputFrame(frame(0x07, { orientation: "landscape_left" })),
	).rejects.toThrow("iOS refused to rotate the simulator");
	expect(mutations).toEqual(["ios-device"]);
});
