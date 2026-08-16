import { describe, expect, test } from "bun:test";
import { deviceHelp } from "../../../cli/workspace-commands";

describe("Agentsims application command help", () => {
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
