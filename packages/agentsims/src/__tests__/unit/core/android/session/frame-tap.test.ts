import { describe, expect, test } from "bun:test";
import { AndroidSession } from "../../../../../core/android/session/session";
import type {
	AndroidStreamFrame,
	AndroidTransport,
	AvccSubscriberSink,
} from "../../../../../core/android/stream/transport";

type FakeTransport = AndroidTransport & {
	starts: number;
	sinks: AvccSubscriberSink[];
	closes: number;
	frames: number;
};

function fakeTransport(frame: AndroidStreamFrame | null): FakeTransport {
	const transport: FakeTransport = {
		backend: "emulator-controller",
		wireTransport: "mmap-videotoolbox-h264",
		closed: false,
		running: false,
		subscriberCount: 0,
		inputReady: true,
		starts: 0,
		sinks: [],
		closes: 0,
		frames: 0,
		// The real transport memoizes its start, so a second call is free.
		start: async () => {
			if (transport.running) return;
			transport.starts += 1;
			(transport as { running: boolean }).running = true;
		},
		close: () => {
			transport.closes += 1;
			(transport as { closed: boolean }).closed = true;
		},
		attachAvccSink: async (sink) => {
			transport.sinks.push(sink);
			return () => {};
		},
		resetVideo: () => true,
		injectTouch: () => true,
		injectMultiTouch: () => true,
		...(frame
			? {
					captureFrame: () => {
						transport.frames += 1;
						return frame;
					},
				}
			: {}),
	};
	return transport;
}

function session(transport: AndroidTransport, serial = "emulator-5554") {
	return new AndroidSession(serial, {
		readScreenConfig: async () => ({
			width: 1080,
			height: 2400,
			orientation: "portrait",
			rotation: 0,
		}),
		warmAx: async () => {},
		createTransport: () => transport,
		frameTapIdleMs: 20,
	});
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Android frame tap", () => {
	test("starts the stream, reads a frame, and leaves no subscriber", async () => {
		const transport = fakeTransport({
			width: 4,
			height: 2,
			rgba: new Uint8Array(4 * 2 * 4).fill(9),
		});
		const device = session(transport);

		const frame = await device.captureFrame();

		expect(frame).toMatchObject({ width: 4, height: 2 });
		expect(transport.starts).toBe(1);
		expect(transport.frames).toBe(1);
		// A frame tap is not an AVCC subscriber, so nothing encodes video.
		expect(transport.sinks).toEqual([]);
		expect(transport.subscriberCount).toBe(0);
		expect(device.frameTapActive).toBe(true);

		// A second read reuses the started stream.
		await device.captureFrame();
		expect(transport.starts).toBe(1);
		expect(transport.frames).toBe(2);

		// The tap expires on its own once the sampling window ends.
		await tick(40);
		expect(device.frameTapActive).toBe(false);

		await device.close();
		expect(transport.closes).toBe(1);
	});

	test("answers null for a backend without a frame buffer", async () => {
		const transport = fakeTransport(null);
		const device = session(transport);

		expect(await device.captureFrame()).toBeNull();
		expect(device.frameTapActive).toBe(false);
		await device.close();
	});

	test("answers null for a physical device without starting a stream", async () => {
		const transport = fakeTransport({
			width: 4,
			height: 2,
			rgba: new Uint8Array(32),
		});
		const device = session(transport, "R5CW1234ABC");

		expect(await device.captureFrame()).toBeNull();
		expect(transport.starts).toBe(0);
		await device.close();
	});

	test("drops the tap when the session closes", async () => {
		const transport = fakeTransport({
			width: 2,
			height: 2,
			rgba: new Uint8Array(16),
		});
		const device = session(transport);

		await device.captureFrame();
		expect(device.frameTapActive).toBe(true);
		await device.close();

		expect(device.frameTapActive).toBe(false);
		expect(await device.captureFrame()).toBeNull();
	});
});
