import { expect, test } from "bun:test";
import { createCameraClient } from "../../../../../web/dock/settings/camera-client";

test("camera discovery uses the selected device API and preserves an empty result", async () => {
	const urls: string[] = [];
	const client = createCameraClient("ios:device", (async (url: string) => {
		urls.push(url);
		return Response.json({ webcams: [] });
	}) as typeof fetch);
	expect(await client.webcams()).toEqual([]);
	expect(urls).toEqual(["/media/camera/webcams?device=ios%3Adevice"]);
});

test("camera status restores the webcam source and mirror without a CLI process", async () => {
	const client = createCameraClient("ios-device", (async () =>
		Response.json({
			camera: {
				alive: true,
				source: "host-camera",
				arg: "host-camera",
				mirror: "on",
				helperPid: 42,
				attachedApps: ["com.example.app"],
			},
		})) as typeof fetch);
	expect(await client.status()).toEqual({
		alive: true,
		source: "webcam",
		arg: "host-camera",
		mirror: "on",
		helperPid: 42,
		bundleIds: ["com.example.app"],
	});
});

test("camera changes use typed media actions for the same device", async () => {
	const requests: Array<{ url: string; body: unknown }> = [];
	const client = createCameraClient("ios-device", (async (
		url: string,
		options: RequestInit,
	) => {
		requests.push({ url, body: JSON.parse(String(options.body)) });
		return Response.json({ ok: true });
	}) as typeof fetch);
	await client.source("image", "/tmp/photo.png", "com.example.app");
	await client.mirror("on");
	await client.stop();
	expect(requests).toEqual([
		{
			url: "/media?device=ios-device",
			body: {
				action: "ios-camera-source",
				source: "image",
				path: "/tmp/photo.png",
				bundleId: "com.example.app",
			},
		},
		{
			url: "/media?device=ios-device",
			body: { action: "ios-camera-mirror", mirror: "on" },
		},
		{ url: "/media/camera/stop?device=ios-device", body: {} },
	]);
});

test("camera discovery reports an API error once without retrying", async () => {
	let requests = 0;
	const client = createCameraClient("ios-device", (async () => {
		requests++;
		return Response.json(
			{ error: "Camera helper unavailable" },
			{ status: 503 },
		);
	}) as typeof fetch);
	await expect(client.webcams()).rejects.toThrow("Camera helper unavailable");
	expect(requests).toBe(1);
});
