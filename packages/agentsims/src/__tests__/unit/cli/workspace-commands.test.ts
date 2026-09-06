import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import {
	addWorkspaceCommands,
	deviceHelp,
} from "../../../cli/workspace-commands";

describe("Agentsims application command help", () => {
	test("serve preserves port flags parsed by the root command", async () => {
		const program = new Command().option("-p, --port <port>", "Port", Number);
		let selectedPort: number | undefined;
		addWorkspaceCommands(program, {
			defaultHost: "127.0.0.1",
			serve: async (_devices, options) => {
				selectedPort = options.port;
			},
			stop: () => {},
		});
		await program.parseAsync(
			["serve", "--port", "3298", "android:emulator-5554"],
			{ from: "user" },
		);
		expect(selectedPort).toBe(3298);
	});
	test("shows the device command groups", () => {
		const help = deviceHelp(undefined, []);
		expect(help).toContain("screenshot");
		expect(help).toContain("camera");
		expect(help).toContain("audio");
	});

	test("shows contextual media help", () => {
		expect(deviceHelp("pixel", ["camera"])).toContain("front <source>");
		expect(deviceHelp("pixel", ["camera", "front"])).toBe(
			"Usage: agentsims device pixel camera front <source> [--url <url>]\n",
		);
		expect(deviceHelp("pixel", ["audio"])).toContain("microphone <on|off>");
	});
});
