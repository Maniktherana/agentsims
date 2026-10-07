import { expect, test } from "bun:test";
import { AndroidSession } from "../../../../../core/android/session/session";
import type { AndroidTransport } from "../../../../../core/android/stream/transport";

const touch = Buffer.concat([Buffer.from([3]), Buffer.from(JSON.stringify({ type: "begin", x: 0.2, y: 0.7 }))]);
function session(touchDevice: () => Promise<void> = async () => {}) {
	return new AndroidSession("R5CW1234ABC", {
		readScreenConfig: async () => ({ width: 1080, height: 1920, orientation: "portrait", rotation: 0 }),
		warmAx: async () => {},
		touchDevice,
	});
}

test("Android workspace owner excludes other input and releases only its owner", async () => {
	let touches = 0;
	const device = session(async () => { touches += 1; });
	await device.start();
	expect(device.reserveInput("a")).toBe(true);
	expect(device.reserveInput("b")).toBe(false);
	await expect(device.dispatchInputFrame(touch)).rejects.toThrow("owned");
	await expect(device.dispatchInputFrame(touch, "b")).rejects.toThrow("owned");
	device.releaseInput("b");
	await device.dispatchInputFrame(touch, "a");
	expect(touches).toBe(1);
	device.releaseInput("a");
	await expect(device.dispatchInputFrame(touch, "a")).rejects.toThrow("owned");
	await device.dispatchInputFrame(touch);
	expect(touches).toBe(2);
	await device.close();
	expect(device.reserveInput("a")).toBe(false);
});

test("Android in-flight input cannot be acquired by a workspace", async () => {
	const completion = Promise.withResolvers<void>();
	const device = session(async () => completion.promise);
	await device.start();
	const input = device.dispatchInputFrame(touch);
	expect(device.reserveInput("lease")).toBe(false);
	completion.resolve();
	await input;
	expect(device.reserveInput("lease")).toBe(true);
	let closed = 0;
	device.attachHidSocket({ send: () => { throw new Error("Unexpected config"); }, on: () => { throw new Error("Unexpected subscription"); }, close: () => { closed += 1; } });
	expect(closed).toBe(1);
	device.releaseInput("lease");
	await device.close();
});

test("owned Android native failure reaches the bridge instead of claiming success", async () => {
	const failure = new Error("Native touch failed");
	const device = session(async () => { throw failure; });
	await device.start();
	expect(device.reserveInput("lease")).toBe(true);
	await expect(device.dispatchInputFrame(touch, "lease")).rejects.toBe(failure);
	device.releaseInput("lease");
	await device.close();
});

test("Android keyframe recovery reuses the attached transport", async () => {
	let resets = 0;
	let transports = 0;
	const transport: AndroidTransport = {
		backend: "emulator-controller", wireTransport: "mmap-videotoolbox-h264",
		closed: false, running: true, subscriberCount: 1, inputReady: true,
		start: async () => {}, close: () => {}, attachAvccSink: async () => () => {},
		resetVideo: () => { resets += 1; return true; },
		injectTouch: () => true, injectMultiTouch: () => true,
	};
	const device = new AndroidSession("emulator-5554", {
		readScreenConfig: async () => ({ width: 1080, height: 1920, orientation: "portrait", rotation: 0 }),
		warmAx: async () => {}, freeEmulatorRotation: async () => {},
		createTransport: () => { transports += 1; return transport; },
	});
	await expect(device.requestVideoKeyframe()).rejects.toThrow("keyframe");
	await device.start();
	await device.attachAvccSink({ closed: false, bufferedBytes: 0, write() {}, close() {}, onClose() {}, onDrain() {} });
	await device.requestVideoKeyframe();
	await device.requestVideoKeyframe();
	expect(transports).toBe(1);
	expect(resets).toBe(2);
	await device.close();
});
