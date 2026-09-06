import { expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import { addCompatibilityCommands } from "../../../cli/device-control";
import { addWorkspaceCommands } from "../../../cli/workspace-commands";
import { registerAndroidCommands } from "../../../cli/android-commands";

function program() {
	const result = new Command();
	addCompatibilityCommands(result);
	addWorkspaceCommands(result, {
		defaultHost: "127.0.0.1",
		serve: async () => {},
		stop: () => {},
	});
	registerAndroidCommands(result);
	return result;
}

test("registered aliases and device options preserve their HTTP requests", async () => {
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
			["tap", "0.2", "0.7", "-d", "android:emulator-5554"],
			["button", "--device", "ios-device"],
			["devices", "start", "android:emulator-5554"],
			["device", "ios-device", "input", "rotate", "landscape_left"],
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
			{
				path: "/device/ios-device/act",
				body: { actions: [{ type: "button", button: "home" }] },
			},
			{ path: "/grid/api/start", body: { udid: "android:emulator-5554" } },
			{
				path: "/device/ios-device/act",
				body: { actions: [{ type: "rotate", orientation: "landscape_left" }] },
			},
		]);
	} finally {
		output.mockRestore();
		await server.stop(true);
	}
});

test("every registration reports one failure and sets exit code 1", async () => {
	const originalExitCode = process.exitCode;
	const errors = spyOn(console, "error").mockImplementation(() => {});
	try {
		for (const args of [
			["act", "{"],
			["device", "ios-device", "input", "unknown"],
			["android", "emulator-5554", "unknown"],
		]) {
			process.exitCode = 0;
			const before = errors.mock.calls.length;
			await program().parseAsync(args, { from: "user" });
			expect(process.exitCode).toBe(1);
			expect(errors.mock.calls.length).toBe(before + 1);
			expect(errors.mock.calls[before]?.[0]).toStartWith("agentsims: ");
		}
	} finally {
		process.exitCode = originalExitCode ?? 0;
		errors.mockRestore();
	}
});
