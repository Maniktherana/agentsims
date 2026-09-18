import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
	AndroidAxServers,
	androidAxFocusLine,
	androidAxKeyLine,
	androidAxPerformLine,
	androidAxRequestLine,
	androidAxTouchLine,
	androidAxServersLayer,
	parseAndroidAxServerLine,
} from "../../../../../core/android/accessibility/ax-server";
import { collectAndroidAxSnapshot } from "../../../../../core/android/accessibility/snapshot";

const XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<hierarchy rotation="0">',
	'<node class="android.widget.FrameLayout" enabled="true" bounds="[0,0][1080,2424]">',
	'<node text="Ask Vartalaap" class="android.widget.TextView" enabled="true" bounds="[40,200][500,280]"></node>',
	"</node>",
	"</hierarchy>",
].join("");

describe("persistent Android AX server", () => {
	test("uses an idle barrier only for settled agent observations", () => {
		expect(JSON.parse(androidAxRequestLine(1, "fresh"))).toEqual({
			id: 1,
			op: "snapshot",
			settled: false,
		});
		expect(JSON.parse(androidAxRequestLine(2, "latest"))).toEqual({
			id: 2,
			op: "snapshot",
			settled: false,
		});
		expect(JSON.parse(androidAxRequestLine(3, "settled"))).toEqual({
			id: 3,
			op: "snapshot",
			settled: true,
		});
	});

	test("writes touch events to the persistent helper protocol", () => {
		expect(JSON.parse(androidAxTouchLine("begin", 100.25, 200.5))).toEqual({
			op: "touch",
			phase: "begin",
			x: 100.25,
			y: 200.5,
		});
	});

	test("writes acknowledged key phases to the persistent helper protocol", () => {
		expect(JSON.parse(androidAxKeyLine(4, "down", 59))).toEqual({
			id: 4,
			op: "key",
			phase: "down",
			keycode: 59,
		});
	});

	test("names a node and what it must still be before it acts on it", () => {
		expect(
			JSON.parse(
				androidAxPerformLine(
					4,
					"set-text",
					{
						node: "focus",
						resourceId: "com.example:id/email",
						className: "android.widget.EditText",
						windowId: 19,
						sourceId: 83,
					},
					"hello",
				),
			),
		).toEqual({
			id: 4,
			op: "perform",
			action: "set-text",
			node: "focus",
			resourceId: "com.example:id/email",
			class: "android.widget.EditText",
			windowId: 19,
			sourceId: 83,
			text: "hello",
		});
		expect(
			JSON.parse(
				androidAxPerformLine(5, "focus", {
					node: "0.2",
					windowId: 19,
					sourceId: 83,
				}),
			),
		).toEqual({
			id: 5,
			op: "perform",
			action: "focus",
			node: "0.2",
			windowId: 19,
			sourceId: 83,
		});
		expect(JSON.parse(androidAxFocusLine(6))).toEqual({ id: 6, op: "focus" });
	});

	test("decodes one atomic full-snapshot response", () => {
		expect(
			parseAndroidAxServerLine(
				JSON.stringify({
					id: 7,
					ok: true,
					elapsedMs: 12.5,
					xml: XML,
				}),
			),
		).toEqual({ id: 7, ok: true, elapsedMs: 12.5, xml: XML });
	});

	test("uses the persistent provider with the requested browser mode", async () => {
		const modes: string[] = [];
		let fallbacks = 0;
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			mode: "fresh",
			readFastXml: async (_serial, mode) => {
				modes.push(mode);
				return XML;
			},
			readFallbackXml: async () => {
				fallbacks++;
				return XML;
			},
			screen: { width: 1080, height: 2424 },
		});

		expect(modes).toEqual(["fresh"]);
		expect(fallbacks).toBe(0);
		expect(snapshot.elements).toHaveLength(2);
	});

	test("reports helper failure without starting a competing UIAutomator", async () => {
		let fallbacks = 0;
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			readFastXml: async () => {
				throw new Error("hidden API unavailable");
			},
			readFallbackXml: async () => {
				fallbacks++;
				return XML;
			},
			screen: { width: 1080, height: 2424 },
		});

		expect(fallbacks).toBe(0);
		expect(snapshot.elements).toHaveLength(0);
		expect(snapshot.errors).toEqual(["hidden API unavailable"]);
	});

	test("closes cached AX clients with the service Layer", async () => {
		let closes = 0;
		const layer = androidAxServersLayer(() => ({
			snapshot: async () => XML,
			warm: async () => {},
			touch: async () => {},
			key: async () => {},
			perform: async () => ({ performed: true, node: null }),
			findFocus: async () => null,
			markMutation: () => {},
			close: () => {
				closes += 1;
			},
		}));
		await Effect.runPromise(
			Effect.gen(function* () {
				const servers = yield* AndroidAxServers;
				expect(yield* servers.read("emulator-test")).toBe(XML);
				yield* servers.warm("emulator-test");
			}).pipe(Effect.provide(layer)),
		);
		expect(closes).toBe(1);
	});
});
