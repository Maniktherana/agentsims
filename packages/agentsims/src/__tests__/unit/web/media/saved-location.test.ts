import { describe, expect, test } from "bun:test";
import { savedLocationLabel } from "../../../../web/media/saved-location";

describe("savedLocationLabel", () => {
	test("names the directory with the home shortcut and never the file", () => {
		expect(
			savedLocationLabel(
				"/Users/manik/Downloads/recording-1532A7C2-2026-11-06T10-00-00-000Z.mp4",
			),
		).toBe("Saved to ~/Downloads");
		expect(
			savedLocationLabel("/home/dev/Downloads/screenshot-emulator-5554.png"),
		).toBe("Saved to ~/Downloads");
		expect(savedLocationLabel("/tmp/a.mp4")).toBe("Saved to /tmp");
	});

	test("a long directory keeps its start and end and stays inside the limit", () => {
		const label = savedLocationLabel(
			"/Users/manik/Projects/clients/very-long-client-name/exports/2026/november/screens/shot.png",
			30,
		);
		const directory = label.slice("Saved to ".length);
		expect(directory.length).toBe(30);
		expect(directory.startsWith("~/Projects")).toBe(true);
		expect(directory.endsWith("screens")).toBe(true);
		expect(directory).toContain("…");
	});
});
