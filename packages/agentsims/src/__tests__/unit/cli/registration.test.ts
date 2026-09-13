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
			requests.push({
				path: url.pathname + url.search,
				body: await request.json(),
			});
			return Response.json({ ok: true });
		},
	});
	const output = spyOn(process.stdout, "write").mockReturnValue(true);
	try {
		for (const args of [
			["act", '{"type":"tap","x":0.2,"y":0.7}', "-d", "android:emulator-5554"],
			["devices", "boot", "android:emulator-5554"],
			["app", "launch", "com.example.app", "-d", "ios-device"],
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
		]);
	} finally {
		output.mockRestore();
		await server.stop(true);
	}
});

test("legacy public commands are removed", () => {
	const names = program()
		.commands.filter((command) => !command.hidden)
		.map((command) => command.name());
	for (const removed of [
		"camera",
		"permissions",
		"ui",
		"android",
		"device",
		"tap",
		"button",
		"ca-debug",
	])
		expect(names).not.toContain(removed);
	for (const current of [
		"start",
		"stop",
		"status",
		"logs",
		"devices",
		"observe",
		"act",
		"app",
		"doctor",
		"setup",
	])
		expect(names).toContain(current);
});
