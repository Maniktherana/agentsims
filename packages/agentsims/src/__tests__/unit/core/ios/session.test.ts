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
import {
	AVCC_TAG_DELTA,
	AVCC_TAG_KEYFRAME,
	avccEnvelope,
} from "../../../../core/stream/avcc-wire";

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
	mjpegSubscriptions = 0;
	readonly avccSubscriptions: (number | undefined)[] = [];
	snapshots = 0;
	size = { width: 100, height: 200 };
	frame = { data: Buffer.from("jpeg"), width: 100, height: 200 };
	private onSize: ((width: number, height: number) => void) | null = null;

	async start(
		onSize: (width: number, height: number) => void,
	): Promise<{ width: number; height: number }> {
		this.onSize = onSize;
		return this.size;
	}
	async stop(): Promise<void> {}
	async snapshot(): Promise<{ data: Uint8Array; width: number; height: number }> {
		this.snapshots += 1;
		return this.frame;
	}
	async subscribeMjpeg(
		_onFrame: (frame: MjpegFrame) => Promise<void>,
	): Promise<() => void> {
		this.mjpegSubscriptions += 1;
		return () => {};
	}
	onAvcc: ((frame: AvccFrame) => Promise<void>) | null = null;
	async subscribeAvcc(
		onFrame: (frame: AvccFrame) => Promise<void>,
		maxEdge?: number,
	): Promise<() => void> {
		this.onAvcc = onFrame;
		this.avccSubscriptions.push(maxEdge);
		return () => {};
	}
	resize(width: number, height: number): void {
		if (!this.onSize) throw new Error("capture is not started");
		this.onSize(width, height);
	}
}

function sessionWith(
	hid: Partial<TestHid> = {},
	onMutation: (udid: string) => void = () => {},
	options: Pick<DeviceSessionDependencies, "describeAccessibility"> = {},
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

test("workspace input ownership blocks other dispatch and releases only its owner", async () => {
	const touches: string[] = [];
	const { session } = sessionWith({ touch: async (phase) => { touches.push(phase); } });
	const touch = frame(0x03, { type: "begin", x: 0.2, y: 0.7 });
	expect(session.reserveInput("a")).toBe(true);
	expect(session.reserveInput("a")).toBe(true);
	expect(session.reserveInput("b")).toBe(false);
	await expect(session.dispatchInputFrame(touch)).rejects.toThrow("owned");
	await expect(session.dispatchInputFrame(touch, "b")).rejects.toThrow("owned");
	session.releaseInput("b");
	await session.dispatchInputFrame(touch, "a");
	expect(touches).toEqual(["begin"]);
	session.releaseInput("a");
	await expect(session.dispatchInputFrame(touch, "a")).rejects.toThrow("owned");
	await session.dispatchInputFrame(touch);
	expect(touches).toEqual(["begin", "begin"]);
	await session.close();
	expect(session.reserveInput("a")).toBe(false);
});

test("workspace cannot acquire in-flight iOS input and rejects a new browser socket", async () => {
	const completion = Promise.withResolvers<void>();
	const { session } = sessionWith({ touch: async () => completion.promise });
	const input = session.dispatchInputFrame(frame(0x03, { type: "begin", x: 0.5, y: 0.5 }));
	expect(session.reserveInput("lease")).toBe(false);
	completion.resolve();
	await input;
	expect(session.reserveInput("lease")).toBe(true);
	let closed = 0;
	session.attachHidSocket({ send: () => { throw new Error("Unexpected config"); }, on: () => { throw new Error("Unexpected socket subscription"); }, close: () => { closed += 1; } });
	expect(closed).toBe(1);
	session.releaseInput("lease");
	await session.close();
});

test("iOS keyframe recovery calls the existing capture without restart", async () => {
	const { session, capture } = sessionWith();
	let requests = 0;
	Object.assign(capture, { requestAvccKeyframe: async () => { requests += 1; } });
	await session.requestVideoKeyframe();
	await session.requestVideoKeyframe();
	expect(requests).toBe(2);
	await session.close();
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

test("a started session encodes nothing and knows its device size", async () => {
	const { session, capture } = sessionWith();
	await session.start();

	expect(capture.mjpegSubscriptions).toBe(0);
	expect(capture.avccSubscriptions).toEqual([]);
	expect(capture.snapshots).toBe(0);
	expect(session.screenConfig()).toEqual({
		width: 100,
		height: 200,
		orientation: "portrait",
	});
});

test("a start that fails while the device boots can be retried", async () => {
	const { session, capture } = sessionWith();
	const start = capture.start.bind(capture);
	let attempts = 0;
	capture.start = async (onSize) => {
		attempts += 1;
		if (attempts === 1) throw new Error("Device not booted (state: Booting)");
		return start(onSize);
	};

	await expect(session.start()).rejects.toThrow("not booted");
	await session.start();
	expect(session.screenConfig()).toMatchObject({ width: 100, height: 200 });
});

test("a screenshot reads the framebuffer at call time without a stream", async () => {
	const { session, capture } = sessionWith();
	capture.frame = { data: Buffer.from("first"), width: 100, height: 200 };
	const first = await session.captureScreenshot();
	capture.frame = { data: Buffer.from("second"), width: 100, height: 200 };
	const second = await session.captureScreenshot();

	expect(first.bytes).toEqual(Buffer.from("first"));
	expect(second.bytes).toEqual(Buffer.from("second"));
	expect(second.sequence).toBeGreaterThan(first.sequence);
	expect(capture.mjpegSubscriptions).toBe(0);
	expect(capture.avccSubscriptions).toEqual([]);
});

test("a surface size change reaches config, input sockets, and touch scale without a viewer", async () => {
	const touches: [number, number][] = [];
	const { session, capture } = sessionWith({
		touch: async (_type, _x, _y, w, h) => {
			touches.push([w, h]);
		},
	});
	await session.start();
	const sent: Buffer[] = [];
	session.attachHidSocket({ send: (data) => sent.push(data), on: () => {}, close: () => {} });

	capture.resize(200, 100);

	expect(session.screenConfig()).toMatchObject({ width: 200, height: 100 });
	const last = sent.at(-1)!;
	expect(last[0]).toBe(0x82);
	expect(JSON.parse(last.subarray(1).toString())).toMatchObject({ width: 200, height: 100 });
	await session.dispatchInputFrame(frame(0x03, { type: "begin", x: 0.5, y: 0.5 }));
	expect(touches).toEqual([[200, 100]]);
});

test("an AVCC viewer gets one snapshot seed and its long-edge limit", async () => {
	const { session, capture } = sessionWith();
	await session.start();
	const writes: Buffer[] = [];
	await session.subscribeAvcc(
		{ write: (chunk) => void writes.push(Buffer.from(chunk)) },
		{ maxEdge: 600 },
	);

	expect(capture.snapshots).toBe(1);
	expect(writes).toHaveLength(1);
	expect(writes[0]![4]).toBe(0x04);
	expect(writes[0]!.subarray(5)).toEqual(Buffer.from("jpeg"));
	expect(capture.avccSubscriptions).toEqual([600]);
	expect(capture.mjpegSubscriptions).toBe(0);
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

test("browser input runs one message at a time and is acknowledged after native dispatch", async () => {
	const touches: Array<{ type: string; done: PromiseWithResolvers<void> }> = [];
	const { session } = sessionWith({
		touch: async (type) => {
			const done = Promise.withResolvers<void>();
			touches.push({ type, done });
			return done.promise;
		},
	});
	await session.start();
	let message: ((data: Buffer) => void) | undefined;
	const sent: Buffer[] = [];
	session.attachHidSocket({
		send: (data) => sent.push(Buffer.from(data)),
		on: (event, callback) => {
			if (event === "message") message = callback as (data: Buffer) => void;
		},
		close: () => {},
	});
	const acks = () => sent.filter((data) => data.length === 1 && data[0] === 0x83).length;
	const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

	message!(frame(0x03, { type: "begin", x: 0.1, y: 0.1 }));
	message!(frame(0x03, { type: "move", x: 0.2, y: 0.1 }));
	await settle();
	// The move waits for the begin. Nothing is acknowledged before the device takes it.
	expect(touches.map((touch) => touch.type)).toEqual(["begin"]);
	expect(acks()).toBe(0);

	touches[0]!.done.resolve();
	await settle();
	expect(touches.map((touch) => touch.type)).toEqual(["begin", "move"]);
	expect(acks()).toBe(1);
	touches[1]!.done.resolve();
	await settle();
	expect(acks()).toBe(2);
	await session.close();
});

test("a live AVCC viewer that falls behind drops deltas and resumes at a requested keyframe", async () => {
	const { session, capture } = sessionWith();
	let keyframeRequests = 0;
	Object.assign(capture, {
		requestAvccKeyframe: async () => {
			keyframeRequests += 1;
		},
	});
	await session.start();
	const writes: Array<{ tag: number; done: PromiseWithResolvers<void> }> = [];
	await session.subscribeAvcc(
		{
			write: (chunk) => {
				const done = Promise.withResolvers<void>();
				writes.push({ tag: chunk[4]!, done });
				return done.promise;
			},
		},
		{ live: true },
	);
	expect(writes.shift()!.tag).toBe(0x04); // seed

	const deliver = async (tag: number) => {
		let returned = false;
		const pending = capture.onAvcc!({
			data: avccEnvelope(tag, new Uint8Array([1])),
			width: 100,
			height: 200,
			isDescription: false,
			isKeyframe: tag === AVCC_TAG_KEYFRAME,
		}).then(() => {
			returned = true;
		});
		await Promise.resolve();
		await pending;
		return returned;
	};

	// A viewer that does not read must not hold back the native encoder.
	expect(await deliver(AVCC_TAG_KEYFRAME)).toBe(true);
	expect(await deliver(AVCC_TAG_DELTA)).toBe(true);
	expect(await deliver(AVCC_TAG_DELTA)).toBe(true);
	expect(writes.map((write) => write.tag)).toEqual([AVCC_TAG_KEYFRAME, AVCC_TAG_DELTA]);

	// Drained: the viewer asks for one keyframe and skips deltas until it arrives.
	for (const write of writes.splice(0)) write.done.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
	expect(keyframeRequests).toBe(1);
	await deliver(AVCC_TAG_DELTA);
	expect(writes).toEqual([]);
	await deliver(AVCC_TAG_KEYFRAME);
	await deliver(AVCC_TAG_DELTA);
	expect(writes.map((write) => write.tag)).toEqual([AVCC_TAG_KEYFRAME, AVCC_TAG_DELTA]);
	await session.close();
});
