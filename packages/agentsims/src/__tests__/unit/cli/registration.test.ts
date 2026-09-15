import { expect, spyOn, test } from "bun:test";
import { createProgram } from "../../../cli/main";

function program() {
	return createProgram().exitOverride();
}

test("public device and app commands use bounded HTTP requests", async () => {
	const requests: Array<{ path: string; body: unknown }> = [];
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const text = await request.text();
			requests.push({
				path: url.pathname + url.search,
				body: text ? JSON.parse(text) : null,
			});
			return Response.json({ ok: true });
		},
	});
	const output = spyOn(process.stdout, "write").mockReturnValue(true);
	try {
		for (const args of [
			["tap", "0.2", "0.7", "-d", "android:emulator-5554"],
			["devices", "boot", "android:emulator-5554"],
			["app", "launch", "com.example.app", "-d", "ios-device"],
			["camera", "webcam", "camera-1", "-d", "ios-device"],
			[
				"permissions",
				"grant",
				"camera",
				"-d",
				"ios-device",
				"--app",
				"com.example.app",
			],
			["device-logs", "-d", "android:emulator-5554", "--level", "e", "--limit", "25"],
		]) {
			await program().parseAsync([...args, "--url", server.url.origin], {
				from: "user",
			});
		}
		expect(requests).toEqual([
			{
				path: "/device/android%3Aemulator-5554/act",
				body: { actions: [{ type: "tap", x: 0.2, y: 0.7 }] },
			},
			{ path: "/grid/api/start", body: { udid: "android:emulator-5554" } },
			{
				path: "/device/ios-device/app",
				body: { operation: "launch", value: "com.example.app" },
			},
			{
				path: "/media/camera/webcam?device=ios-device",
				body: { platform: "ios", webcamId: "camera-1" },
			},
			{
				path: "/device/ios-device/permissions",
				body: {
					operation: "grant",
					bundleId: "com.example.app",
					permission: "camera",
				},
			},
			{
				path: "/android/logs/snapshot?device=android%3Aemulator-5554&limit=25&level=E",
				body: null,
			},
		]);
	} finally {
		output.mockRestore();
		await server.stop(true);
	}
});

test("the command surface stays explicit", () => {
	// Read the help text, which is the surface a user actually sees. Commander
	// keeps its hidden flag private, so the command list includes hidden ones.
	const help = program().helpInformation();
	const names = help
		.slice(help.indexOf("Commands:"))
		.split("\n")
		.map((line) => /^ {2}(\S+)/.exec(line)?.[1])
		.filter((name): name is string => Boolean(name))
		.map((name) => name.split("|")[0]!);
	// `act` still accepts a JSON action, but it is hidden in favour of the
	// named input commands below.
	for (const removed of ["ui", "android", "device", "ca-debug", "setup", "act"])
		expect(names).not.toContain(removed);
	for (const current of [
		"start",
		"stop",
		"status",
		"logs",
		"device-logs",
		"devices",
		"observe",
		"tap",
		"swipe",
		"text",
		"button",
		"rotate",
		"gesture",
		"app",
		"camera",
		"permissions",
		"doctor",
	])
		expect(names).toContain(current);
});
