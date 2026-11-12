import { describe, expect, test } from "bun:test";
import {
	HostScreenshotSave,
	hostScreenshotFileName,
	parseHostScreenshot,
} from "../../../../../web/simulator/screenshot/host-screenshot";
import { RECORDING_OUT_DIR } from "../../../../../web/hooks/simulator/use-screen-recording";

const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });

describe("host screenshot save", () => {
	test("uses the recording name scheme with a screenshot prefix", () => {
		expect(
			hostScreenshotFileName("android:emulator-5554", new Date("2026-11-06T10:00:00.000Z")),
		).toBe("screenshot-android_emulator-5554-2026-11-06T10-00-00-000Z.png");
	});

	test("captures with the CLI at the click and moves the file to the recordings directory on save", async () => {
		const commands: string[] = [];
		const exec = async (command: string) => {
			commands.push(command);
			if (command.includes("agentsims screenshot"))
				return ok(
					JSON.stringify({
						artifact: { status: "ok", path: "/tmp/agentsims-pending-shot.png" },
					}),
				);
			return ok("/Users/x/Downloads/screenshot-ios-2026.png");
		};
		const save = new HostScreenshotSave(exec, "ios-device");
		expect(commands[0]).toContain("agentsims screenshot");
		expect(commands[0]).toContain("-d 'ios-device'");
		const path = await save.commit();
		expect(path).toBe("/Users/x/Downloads/screenshot-ios-2026.png");
		expect(commands[1]).toContain(`mkdir -p ${RECORDING_OUT_DIR}`);
		expect(commands[1]).toContain("'/tmp/agentsims-pending-shot.png'");
	});

	test("a discarded preview removes the pending file and cannot be saved", async () => {
		const commands: string[] = [];
		const exec = async (command: string) => {
			commands.push(command);
			return ok(
				JSON.stringify({ artifact: { status: "ok", path: "/tmp/p.png" } }),
			);
		};
		const save = new HostScreenshotSave(exec, "ios-device");
		save.discard();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(commands.at(-1)).toBe("rm -f '/tmp/p.png'");
		await expect(save.commit()).rejects.toThrow("Screenshot was not saved.");
	});

	test("a failed capture reports the reason", () => {
		expect(() =>
			parseHostScreenshot(
				ok(JSON.stringify({ image: { status: "error", error: "No frame" }, artifact: null })),
			),
		).toThrow("No frame");
	});
});
