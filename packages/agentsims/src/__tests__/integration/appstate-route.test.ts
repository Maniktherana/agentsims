import { expect, test } from "bun:test";
import type { DeviceState } from "../../shared/state";
import { startTestServer } from "../helpers/server";

const DEVICE = "android:emulator-5554";
const state: DeviceState = {
	pid: 1,
	port: 3200,
	device: DEVICE,
	url: "http://127.0.0.1:3200",
	streamUrl: "http://127.0.0.1:3200/stream.avcc",
	wsUrl: "ws://127.0.0.1:3200/ws",
};

test("appstate streams the Android foreground-app contract", async () => {
	const calls: string[] = [];
	const started = await startTestServer({
		previewAssets: {},
		readDeviceStates: async () => [state],
		readForegroundApp: async (device) => {
			calls.push(device);
			return { bundleId: "com.example.android", pid: 42, isReactNative: false };
		},
	});
	try {
		const response = await fetch(
			`${started.origin}/appstate?device=${encodeURIComponent(DEVICE)}`,
		);
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		const decoder = new TextDecoder();
		let body = "";
		while (!body.includes("data:")) {
			const next = await reader.read();
			if (next.done) break;
			body += decoder.decode(next.value, { stream: true });
		}
		await reader.cancel();

		const payload = body.match(/data: (.+)\n\n/)?.[1];
		expect(payload && JSON.parse(payload)).toEqual({
			bundleId: "com.example.android",
			pid: 42,
			isReactNative: false,
		});
		expect(calls).toEqual([DEVICE]);
	} finally {
		await started.server.stop();
	}
});
