import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
	AndroidEnvironmentState,
	AndroidToolCapabilities,
} from "../../../../../android/contracts";
import {
	AndroidControlsPanel,
	AndroidSimulatorControlRows,
	networkLatencyLabel,
	networkSpeedLabel,
} from "../../../../../web/components/android/android-controls-panel";
import {
	SavedStateList,
	savedStateDate,
} from "../../../../../web/components/android/android-saved-states";
import { androidControlFeedback } from "../../../../../web/components/dock/settings/android-device-controls-tool";

const capabilities: AndroidToolCapabilities = {
	device: "android:emulator-5554",
	emulator: true,
	apiLevel: 35,
	appLocale: true,
	wifi: true,
	mobileData: true,
	airplaneMode: true,
	talkback: true,
	telephony: true,
	snapshots: true,
	networkConditions: true,
	location: true,
};
const state: AndroidEnvironmentState = {
	network: {
		wifi: true,
		data: false,
		airplane: true,
		downloadBps: 1_250_000,
		uploadBps: 750_000,
		minLatencyMs: 20,
		maxLatencyMs: 40,
	},
	battery: { level: 73, charging: true, simulated: false },
	display: { density: 440, talkback: false },
};
const renderControls = (current: AndroidEnvironmentState | null) => {
	const props = {
		deviceId: capabilities.device,
		basePath: "/",
		active: true,
		capabilities,
		state: current,
		busy: false,
		run: async () => true,
	};
	return renderToStaticMarkup(
		<>
			<AndroidSimulatorControlRows {...props} />
			<AndroidControlsPanel {...props} />
		</>,
	);
};

test("network switches reflect real device state and use the existing dropdown component", () => {
	const html = renderControls(state);
	expect(html).toContain(
		'role="switch" aria-checked="true" aria-label="Wi-Fi"',
	);
	expect(html).toContain(
		'role="switch" aria-checked="false" aria-label="Mobile data"',
	);
	expect(html).toContain(
		'role="switch" aria-checked="true" aria-label="Airplane mode"',
	);
	expect(html).toContain('value="73"');
	expect(html).toContain('value="440"');
	expect(html).not.toContain("<select");
	expect(html).toContain('aria-label="Network speed" aria-haspopup="listbox"');
	expect(html).toContain('aria-label="Call event" aria-haspopup="listbox"');
	expect(html).not.toContain("<pre");
});

test("unknown network values remain visibly unavailable instead of an assumed preset", () => {
	const html = renderControls(null);
	expect(html).toContain("Current state unavailable");
	expect(html).toMatch(
		/role="switch" aria-checked="false" aria-label="Wi-Fi" disabled=""/,
	);
	expect(networkSpeedLabel(undefined)).toBe("↓ Unknown · ↑ Unknown");
	expect(networkLatencyLabel(undefined)).toBe("Current unavailable");
	expect(networkSpeedLabel(state.network)).toBe("↓ 1.25 Mbps · ↑ 750 kbps");
	expect(networkLatencyLabel(state.network)).toBe("20–40 ms");
});

test("saved states show readable metadata and direct per-state actions", () => {
	const html = renderToStaticMarkup(
		<SavedStateList
			states={[
				{ name: "signed-in", size: "32 MB", savedAt: "2026-09-06T10:30:00Z" },
				{ name: "default_boot", size: "24 MB", savedAt: "" },
			]}
			busy={false}
			onRestore={() => {}}
			onDelete={() => {}}
		/>,
	);
	expect(html).toContain("signed-in");
	expect(html).toContain("32 MB");
	expect(html).toContain('aria-label="Restore signed-in"');
	expect(html).toContain('aria-label="Delete default_boot"');
	expect(html).toContain("Date unavailable");
	expect(html).not.toContain("<pre");
	expect(savedStateDate("")).toBe("Date unavailable");
	const empty = renderToStaticMarkup(
		<SavedStateList
			states={[]}
			busy={false}
			onRestore={() => {}}
			onDelete={() => {}}
		/>,
	);
	expect(empty).toContain("No snapshots yet");
});

test("writes produce action-specific feedback", () => {
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

test("network and battery are plain settings rows without reset actions", () => {
	const html = renderToStaticMarkup(
		<AndroidSimulatorControlRows
			capabilities={capabilities}
			state={state}
			busy={false}
			run={async () => true}
		/>,
	);
	expect(html).not.toContain("<details");
	expect(html).not.toContain("Reset");
	for (const label of [
		"Wi-Fi",
		"Mobile data",
		"Airplane mode",
		"Network speed",
		"Network latency",
		"Battery percent",
		"Charging",
	]) {
		expect(html).toContain(`data-setting-row="${label}"`);
	}
});

test("device snapshots, display and calls remain separate sections", () => {
	const html = renderToStaticMarkup(
		<AndroidControlsPanel
			deviceId={capabilities.device}
			basePath="/"
			active
			capabilities={capabilities}
			state={state}
			busy={false}
			run={async () => true}
		/>,
	);
	expect(html.match(/<details/g)).toHaveLength(3);
	expect(html.indexOf("Device snapshots")).toBeLessThan(
		html.indexOf("Display and accessibility"),
	);
	expect(html.indexOf("Display and accessibility")).toBeLessThan(
		html.indexOf("Calls and messages"),
	);
	expect(html).not.toContain('data-setting-row="Wi-Fi"');
	expect(html).not.toContain('data-setting-row="Battery percent"');
});
