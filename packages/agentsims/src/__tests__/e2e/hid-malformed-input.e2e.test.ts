import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	acquireIosSimulatorTestLock,
	IOS_E2E_HOOK_TIMEOUT_MS,
} from "../helpers/ios-e2e-lock";
import {
	explicitIosDevice,
	startOwnedE2EServer,
	type OwnedE2EServer,
} from "../helpers/native-e2e";

const WS_TAG_TOUCH = 0x03;
const describeConfigured = explicitIosDevice ? describe : describe.skip;

function frame(payload: unknown): Uint8Array {
	const body = new TextEncoder().encode(JSON.stringify(payload));
	const value = new Uint8Array(body.length + 1);
	value[0] = WS_TAG_TOUCH;
	value.set(body, 1);
	return value;
}

async function sendFrames(
	url: string,
	values: readonly unknown[],
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const socket = new WebSocket(url);
		socket.binaryType = "arraybuffer";
		socket.onerror = () => reject(new Error(`Failed to connect to ${url}.`));
		socket.onclose = () => resolve();
		socket.onopen = () => {
			for (const value of values) socket.send(frame(value));
			socket.close();
		};
	});
}

describeConfigured("native malformed HID input", () => {
	let server: OwnedE2EServer;
	let releaseLock = () => {};

	beforeAll(async () => {
		releaseLock = await acquireIosSimulatorTestLock(explicitIosDevice!);
		server = await startOwnedE2EServer();
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	afterAll(async () => {
		try {
			await server?.stop();
		} finally {
			releaseLock();
		}
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	test("a malformed touch leaves the native session reachable", async () => {
		const helper = `${server.origin}/helper/${encodeURIComponent(explicitIosDevice!)}`;
		await sendFrames(helper.replace(/^http/, "ws") + "/ws", [
			{ x: 0.5, y: 0.5 },
			{ type: "begin", x: 0.5, y: 0.5 },
			{ type: "end", x: 0.5, y: 0.5 },
		]);
		const response = await fetch(`${helper}/config`);
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			width: expect.any(Number),
			height: expect.any(Number),
		});
	}, 30_000);
});
