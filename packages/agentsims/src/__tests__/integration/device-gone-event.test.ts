import { afterAll, beforeAll, expect, test } from "bun:test";
import type { PreviewServer } from "../../server/http/server";
import type { DeviceState } from "../../core/tools/devices/state";
import { startTestServer } from "../helpers/server";

const DEVICE = "ios-device";

let server: PreviewServer;
let origin: string;
let present = true;

const state: DeviceState = {
	pid: process.pid,
	port: 3200,
	device: DEVICE,
	url: "http://127.0.0.1:3200",
	streamUrl: "http://127.0.0.1:3200/stream",
	wsUrl: "ws://127.0.0.1:3200/ws",
};

beforeAll(async () => {
	const started = await startTestServer({
		device: DEVICE,
		readDeviceStates: async () => (present ? [state] : []),
	});
	server = started.server;
	origin = started.origin;
});

afterAll(async () => {
	await server?.stop();
});

async function* events(signal: AbortSignal) {
	const response = await fetch(`${origin}/api/events?device=${DEVICE}`, {
		signal,
	});
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let boundary: number;
		while ((boundary = buffer.indexOf("\n\n")) !== -1) {
			const block = buffer.slice(0, boundary);
			buffer = buffer.slice(boundary + 2);
			if (block.startsWith("data:")) yield block.slice(5).trim();
		}
	}
}

test("a device going away is sent as an event, not as silence", async () => {
	present = true;
	const controller = new AbortController();
	const received: string[] = [];
	try {
		for await (const data of events(controller.signal)) {
			received.push(data);
			if (received.length === 1) {
				expect(JSON.parse(data).device).toBe(DEVICE);
				present = false;
				continue;
			}
			break;
		}
	} finally {
		controller.abort();
	}
	expect(received).toHaveLength(2);
	expect(received[1]).toBe("null");
}, 15_000);

test("an unchanged device does not re-send its config on every poll", async () => {
	present = true;
	const controller = new AbortController();
	const received: string[] = [];
	const timer = setTimeout(() => controller.abort(), 3_000);
	try {
		for await (const data of events(controller.signal)) received.push(data);
	} catch {
		/* aborted */
	} finally {
		clearTimeout(timer);
	}
	expect(received).toHaveLength(1);
}, 15_000);
