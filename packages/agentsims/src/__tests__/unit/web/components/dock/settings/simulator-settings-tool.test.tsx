import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	isIosRuntime,
	SettingRow,
} from "../../../../../../web/components/dock/settings/simulator-settings-tool";

// The in-sim settings helper is an iOS-simulator Mach-O; spawning it inside a
// watchOS / tvOS / visionOS runtime aborts in dyld. The panel gates on the
// device runtime so non-iOS devices never trigger that spawn.
describe("isIosRuntime", () => {
	test("iOS runtimes are supported", () => {
		expect(isIosRuntime("iOS-26-5")).toBe(true);
		expect(isIosRuntime("iOS-18-0")).toBe(true);
	});

	test("non-iOS runtimes are unsupported", () => {
		expect(isIosRuntime("watchOS-11-2")).toBe(false);
		expect(isIosRuntime("tvOS-18-0")).toBe(false);
		expect(isIosRuntime("xrOS-2-0")).toBe(false);
		expect(isIosRuntime("visionOS-2-0")).toBe(false);
	});

	test("unknown/null runtime falls back to supported so the panel still renders", () => {
		expect(isIosRuntime(null)).toBe(true);
		expect(isIosRuntime("")).toBe(true);
	});
});

describe("SettingRow", () => {
	test("renders its label, description, and control", () => {
		const html = renderToStaticMarkup(
			<SettingRow
				icon={<span>icon</span>}
				label="Front camera"
				description="Startup route"
			>
				<span>control</span>
			</SettingRow>,
		);

		expect(html).toContain("icon");
		expect(html).toContain("Front camera");
		expect(html).toContain("Startup route");
		expect(html).toContain("control");
	});
});
