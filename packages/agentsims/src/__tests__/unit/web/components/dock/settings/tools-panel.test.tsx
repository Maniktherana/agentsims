import { describe, expect, test } from "bun:test";
import type { AndroidStatus } from "../../../../../../core/android/device/types";
import {
	formatAndroidDisplay,
	formatAndroidStream,
} from "../../../../../../web/components/dock/settings/android-controls-tool";

const status: AndroidStatus = {
	platform: "android",
	serial: "emulator-5554",
	release: "17",
	screen: {
		width: 1080,
		height: 2424,
		density: 420,
		orientation: "portrait",
	},
	stream: {
		backend: "emulator-controller",
		transport: "mmap-videotoolbox-h264",
		source: "display",
		canChangeSource: false,
	},
	camera: { canChangeLive: false },
	audio: {
		hostRoute: "emulator-default",
		canChangeLive: false,
	},
};

describe("Android metadata formatting", () => {
	test("formats display details", () => {
		expect(formatAndroidDisplay(status)).toBe("1080 × 2424 @ 420 dpi");
	});

	test("formats transport details without raw backend names", () => {
		expect(formatAndroidStream(status)).toBe("H.264 · emulator framebuffer");
		expect(
			formatAndroidStream({
				...status,
				stream: {
					...status.stream,
					backend: "unsupported",
					transport: "none",
				},
			}),
		).toBe("Live stream unavailable");
	});
});
