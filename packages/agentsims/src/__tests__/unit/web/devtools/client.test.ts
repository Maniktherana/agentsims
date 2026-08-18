import { describe, expect, test } from "bun:test";
import {
	proxyDevToolsTargetForBrowser,
	type DevToolsTarget,
} from "../../../../web/devtools/client";

const target: DevToolsTarget = {
	id: "sim:page:1",
	title: "Example",
	url: "https://example.test",
	type: "page",
	provider: "webkit",
	device: "ios-device",
	webSocketDebuggerUrl: "ws://127.0.0.1:3200/.sim/devtools/page/sim%3Apage%3A1",
	devtoolsFrontendUrl:
		"/.sim/devtools-frontend/inspector.html?ws=127.0.0.1%3A3200%2F.sim%2Fdevtools%2Fpage%2Fsim%253Apage%253A1",
};

describe("proxyDevToolsTargetForBrowser", () => {
	test("keeps the direct WebKit bridge URL", () => {
		expect(
			proxyDevToolsTargetForBrowser(target, {
				protocol: "https:",
				host: "tunnel.example.com",
			} as Location),
		).toEqual(target);
	});

	test("reanchors Android CDP to the browser host", () => {
		const proxied = proxyDevToolsTargetForBrowser(
			{ ...target, provider: "android-cdp" },
			{ protocol: "https:", host: "tunnel.example.com" } as Location,
		);
		expect(proxied.webSocketDebuggerUrl).toBe(
			"wss://tunnel.example.com/.sim/devtools/page/sim%3Apage%3A1",
		);
	});
});
