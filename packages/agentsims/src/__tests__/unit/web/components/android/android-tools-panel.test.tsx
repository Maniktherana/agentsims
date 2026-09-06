import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AndroidToolsPanel } from "../../../../../web/components/android/android-tools-panel";
import { AndroidDeviceControlsTool } from "../../../../../web/components/dock/settings/android-device-controls-tool";
import { ToolsPanel } from "../../../../../web/components/dock/settings/tools-panel";
import { AndroidLogsPanel } from "../../../../../web/components/android/android-logs-panel";

describe("Android tool panel integration", () => {
	test("renders app management and logs as collapsed Settings sections", () => {
		const html = renderToStaticMarkup(
			<AndroidToolsPanel
				deviceId="android:emulator-5554"
				basePath="/preview"
			/>,
		);
		expect(html).toContain(">Install &amp; manage apps</span>");
		expect(html).toContain(">Logs</span>");
		expect(html.match(/<details/g)).toHaveLength(2);
		expect(html).not.toContain('role="tab');
		expect(html).not.toContain('role="log"');
		expect(html).not.toMatch(/<details[^>]* open/);
	});
	test("puts additional controls in original Settings sections without duplicating Location", () => {
		const html = renderToStaticMarkup(
			<AndroidDeviceControlsTool udid="android:emulator-5554">
				{({ simulatorRows, deviceSections }) => (
					<>
						{simulatorRows}
						{deviceSections}
					</>
				)}
			</AndroidDeviceControlsTool>,
		);
		expect(html).toContain("Wi-Fi");
		expect(html).toContain("Battery percent");
		expect(html).toContain("Display and accessibility");
		expect(html).toContain("lem-section");
		expect(html).not.toContain("Latitude");
		expect(html).not.toContain('role="tablist"');
	});

	test("keeps filters collapsible and the log viewport keyboard scrollable", () => {
		const html = renderToStaticMarkup(
			<AndroidLogsPanel deviceId="android:pixel" basePath="/" />,
		);
		const details = html.match(/<details[^>]*>/)?.[0];
		expect(details).toBeDefined();
		expect(details).not.toContain("open");
		expect(html).toContain("Log filters");
		expect(html).toMatch(/role="log"[^>]*tabindex="0"/);
		expect(html).toContain('aria-live="off"');
	});
});

test("Android control sections follow Location and Simulator contains no nested accordion", () => {
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { pathname: "/" } },
	});
	let html: string;
	try {
		html = renderToStaticMarkup(
			<ToolsPanel
				open
				onClose={() => {}}
				udid="android:emulator-5554"
				deviceRuntime="Android-17"
				currentApp={null}
				codecPreference="auto"
				onCodecPreferenceChange={() => {}}
				activeCodec="h264"
				avccSupported
				width={560}
			/>,
		);
	} finally {
		if (previousWindow)
			Object.defineProperty(globalThis, "window", previousWindow);
		else Reflect.deleteProperty(globalThis, "window");
	}
	const simulatorStart = html.indexOf('data-android-simulator-settings=""');
	const simulatorEnd = html.indexOf("</details>", simulatorStart);
	const simulator = html.slice(simulatorStart, simulatorEnd);
	expect(simulator).toContain('data-setting-row="Wi-Fi"');
	expect(simulator).toContain('data-setting-row="Battery percent"');
	expect(simulator).not.toContain("<details");
	expect(html.indexOf(">Location<")).toBeGreaterThan(simulatorEnd);
	expect(html.indexOf("Display and accessibility")).toBeGreaterThan(
		html.indexOf(">Location<"),
	);
	expect(html).not.toContain("Reset conditions");
	expect(html).not.toContain("Reset battery");
});
