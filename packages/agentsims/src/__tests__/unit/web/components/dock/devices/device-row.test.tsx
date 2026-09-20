import { describe, expect, test } from "bun:test";
import { resolveDeviceLifecyclePhase } from "../../../../../../web/components/dock/devices/device-row";

describe("resolveDeviceLifecyclePhase", () => {
	test("resolves settled and transitional lifecycle phases", () => {
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutdown", helper: null },
				false,
				false,
			),
		).toBe("available");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutdown", helper: null },
				true,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				true,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				true,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booting", helper: null },
				false,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Creating", helper: null },
				false,
				false,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Shutting Down", helper: null },
				false,
				false,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{
					state: "Shutting Down",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				},
				false,
				false,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{
					state: "Shutting Down",
					helper: {
						port: 3100,
						url: "http://localhost:3100",
						streamUrl: "http://localhost:3100/stream.mjpeg",
						wsUrl: "ws://localhost:3100/ws",
					},
				},
				false,
				false,
				true,
			),
		).toBe("shutting-down");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booting", helper: null },
				false,
				false,
				true,
			),
		).toBe("booting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "offline", helper: null },
				false,
				false,
			),
		).toBe("connecting");
	});

	test("lets the active browser transport override stale helper state both ways", () => {
		const helper = {
			port: 3100,
			url: "http://localhost:3100",
			streamUrl: "http://localhost:3100/stream.mjpeg",
			wsUrl: "ws://localhost:3100/ws",
		};

		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper: null },
				false,
				false,
				true,
			),
		).toBe("streaming");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper },
				false,
				false,
				false,
			),
		).toBe("connecting");
		expect(
			resolveDeviceLifecyclePhase(
				{ state: "Booted", helper },
				false,
				false,
				undefined,
			),
		).toBe("streaming");
	});

});
