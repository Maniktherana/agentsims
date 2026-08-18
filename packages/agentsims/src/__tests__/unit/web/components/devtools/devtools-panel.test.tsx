import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DevToolsTargetPicker } from "../../../../../web/components/devtools/devtools-target-picker";
import type { DevToolsTarget } from "../../../../../web/devtools/client";

const target = (id: string, title: string): DevToolsTarget => ({
	id,
	device: "ios-device",
	provider: "webkit",
	title,
	url: `https://${id}.test`,
	type: "page",
	webSocketDebuggerUrl: `ws://localhost/${id}`,
	devtoolsFrontendUrl: `/devtools/${id}`,
});

describe("DevTools page switcher", () => {
	test("uses one 28px-wide-row trigger for multiple pages", () => {
		const html = renderToStaticMarkup(
			<DevToolsTargetPicker
				targets={[target("one", "First"), target("two", "Second")]}
				selected={target("one", "First")}
				onSelectTarget={() => {}}
			/>,
		);
		expect(html).toContain("h-7");
		expect(html).toContain("w-full");
		expect(html).toContain("First");
		expect(html).not.toContain("Chrome");
	});
});
