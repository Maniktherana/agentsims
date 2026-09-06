import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type Socket } from "node:net";
import {
	cameraHelperFiles,
	currentHelperPid,
	readInjectedBundles,
	sendHelperCommand,
} from "../../../../ios/device/camera-helper";

test("camera state only returns bundles for the current live helper", () => {
	const udid = randomUUID();
	const files = cameraHelperFiles(udid);
	mkdirSync(dirname(files.pid), { recursive: true });
	try {
		writeFileSync(files.pid, String(process.pid));
		writeFileSync(
			files.bundles,
			JSON.stringify({
				helperPid: process.pid,
				bundleIds: ["com.test.app", 12],
			}),
		);
		expect(currentHelperPid(udid)).toBe(process.pid);
		expect(readInjectedBundles(udid)).toEqual(["com.test.app"]);
		writeFileSync(
			files.bundles,
			JSON.stringify({ helperPid: process.pid + 1, bundleIds: ["stale"] }),
		);
		expect(readInjectedBundles(udid)).toEqual([]);
		writeFileSync(files.pid, "-1");
		expect(currentHelperPid(udid)).toBeNull();
		expect(cameraHelperFiles(randomUUID()).socket).not.toBe(files.socket);
		expect(files.socket.length).toBeLessThan(104);
	} finally {
		rmSync(files.pid, { force: true });
		rmSync(files.bundles, { force: true });
	}
});

async function withHelper(
	reply: (socket: Socket, request: unknown) => void,
	body: (udid: string) => Promise<void>,
) {
	const udid = randomUUID();
	const files = cameraHelperFiles(udid);
	const sockets = new Set<Socket>();
	const server = createServer((socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
		socket.once("data", (data) => reply(socket, JSON.parse(data.toString())));
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(files.socket, resolve);
	});
	try {
		await body(udid);
	} finally {
		for (const socket of sockets) socket.destroy();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		rmSync(files.socket, { force: true });
	}
}

test("camera IPC reassembles a split JSON line and closes after the reply", async () => {
	await withHelper(
		(socket, request) => {
			expect(request).toEqual({ action: "status" });
			socket.write('{"ok":true,');
			setTimeout(() => socket.write('"source":"webcam"}\n'), 5);
		},
		async (udid) => {
			expect(await sendHelperCommand(udid, { action: "status" })).toEqual({
				ok: true,
				source: "webcam",
			});
		},
	);
});

test("camera IPC rejects malformed, oversized and incomplete replies", async () => {
	for (const [reply, message] of [
		[(socket: Socket) => socket.end("invalid\n"), "JSON"],
		[(socket: Socket) => socket.write("x".repeat(65537)), "too large"],
		[(socket: Socket) => socket.end('{"ok":'), "socket closed"],
	] as const) {
		await withHelper(reply, async (udid) => {
			await expect(
				sendHelperCommand(udid, { action: "status" }),
			).rejects.toThrow(message);
		});
	}
});

test("camera IPC times out a silent helper", async () => {
	await withHelper(
		() => {},
		async (udid) => {
			await expect(
				sendHelperCommand(udid, { action: "status" }),
			).rejects.toThrow("timeout");
		},
	);
}, 5000);
