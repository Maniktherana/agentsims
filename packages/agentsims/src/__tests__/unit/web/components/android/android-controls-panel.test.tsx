import { expect, test } from "bun:test";
import {
	networkLatencyLabel,
	networkSpeedLabel,
} from "../../../../../web/components/android/android-controls-panel";
import { savedStateDate } from "../../../../../web/components/android/android-saved-states";
import { androidControlFeedback } from "../../../../../web/components/dock/settings/android-device-controls-tool";

test("formats Android network conditions", () => {
	expect(networkSpeedLabel(undefined)).toBe("—");
	expect(networkLatencyLabel(undefined)).toBe("—");
	expect(
		networkSpeedLabel({
			downloadBps: 1_250_000,
			uploadBps: 750_000,
			minLatencyMs: 20,
			maxLatencyMs: 40,
		}),
	).toBe("↓ 1.25 Mbps · ↑ 750 kbps");
	expect(
		networkLatencyLabel({
			downloadBps: 1_250_000,
			uploadBps: 750_000,
			minLatencyMs: 20,
			maxLatencyMs: 40,
		}),
	).toBe("20–40 ms");
});

test("formats unavailable saved-state dates", () => {
	expect(savedStateDate("")).toBe("Date unavailable");
});

test("produces action-specific Android control feedback", () => {
	expect(androidControlFeedback({ type: "network", wifi: true }).success).toBe(
		"Wi-Fi enabled",
	);
	expect(androidControlFeedback({ type: "battery", level: 50 }).success).toBe(
		"Battery set to 50%",
	);
	expect(
		androidControlFeedback({
			type: "snapshot",
			operation: "save",
			name: "signed-in",
		}).success,
	).toBe("Saved snapshot “signed-in”");
	expect(
		androidControlFeedback({
			type: "snapshot",
			operation: "load",
			name: "signed-in",
		}).success,
	).toBe("Restored snapshot “signed-in”");
	expect(
		androidControlFeedback({
			type: "snapshot",
			operation: "delete",
			name: "signed-in",
		}).failure,
	).toBe("Could not delete snapshot “signed-in”");
});
