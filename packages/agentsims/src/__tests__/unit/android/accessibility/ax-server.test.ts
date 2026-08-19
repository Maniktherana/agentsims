import { describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { Effect } from "effect";
import {
	AndroidAxServerClient,
	AndroidAxServers,
	androidAxRequestLine,
	androidAxTouchLine,
	androidAxServersLayer,
	parseAndroidAxServerLine,
	resolveAndroidAxServer,
	subscribeAndroidAxChanges,
} from "../../../../android/accessibility/ax-server";
import { collectAndroidAxSnapshot } from "../../../../android/device/device";

const XML = [
	'<?xml version="1.0" encoding="UTF-8"?>',
	'<hierarchy rotation="0">',
	'<node class="android.widget.FrameLayout" enabled="true" bounds="[0,0][1080,2424]">',
	'<node text="Ask Vartalaap" class="android.widget.TextView" enabled="true" bounds="[40,200][500,280]"></node>',
	"</node>",
	"</hierarchy>",
].join("");

describe("persistent Android AX server", () => {
	test("resolves the bundled server artifact from the source layout", () => {
		expect(existsSync(resolveAndroidAxServer())).toBe(true);
	});

	test("bundles generated helper classes into the production dex", () => {
		const artifact = resolveAndroidAxServer();
		const extracted = Bun.spawnSync(["unzip", "-p", artifact, "classes.dex"]);
		expect(extracted.exitCode).toBe(0);
		for (const descriptor of [
			"Ldev/agentsims/ax/Main;",
			"Ldev/agentsims/ax/Main$1;",
			"Ldev/agentsims/ax/Main$2;",
			"Ldev/agentsims/ax/Main$WindowMetadata;",
		]) {
			expect(extracted.stdout.includes(Buffer.from(descriptor))).toBe(true);
		}
	});

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

	test("dispatches native changed lines to stable per-serial subscribers", () => {
		const changes: unknown[] = [];
		const unsubscribe = subscribeAndroidAxChanges("event-probe", (change) =>
			changes.push(change),
		);
		const client = new AndroidAxServerClient("event-probe");
		const protocolClient = client as unknown as {
			onStdout(chunk: string): void;
		};

		protocolClient.onStdout(
			'{"event":"changed","sequence":4,"eventTypes":2048,"atMs":91}\n',
		);
		expect(changes).toEqual([
			{
				sequence: 4,
				eventTypes: 2048,
				atMs: 91,
			},
		]);

		unsubscribe();
		protocolClient.onStdout(
			'{"event":"changed","sequence":5,"eventTypes":32,"atMs":92}\n',
		);
		expect(changes).toHaveLength(1);
		client.close();
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
		});

		expect(modes).toEqual(["fresh"]);
		expect(fallbacks).toBe(0);
		expect(snapshot.elements).toHaveLength(2);
	});

	test("falls back to the stock UIAutomator dump when the helper is unavailable", async () => {
		let fallbacks = 0;
		const snapshot = await collectAndroidAxSnapshot("emulator-5554", {
			readFastXml: async () => {
				throw new Error("hidden API unavailable");
			},
			readFallbackXml: async () => {
				fallbacks++;
				return XML;
			},
		});

		expect(fallbacks).toBe(1);
		expect(snapshot.elements.at(-1)?.label).toBe("Ask Vartalaap");
		expect(snapshot.errors?.[0]).toContain(
			"Fast Android AX unavailable; using stock UIAutomator",
		);
	});

	test("closes cached AX clients with the service Layer", async () => {
		let closes = 0;
		const layer = androidAxServersLayer(() => ({
			snapshot: async () => XML,
			warm: async () => {},
			touch: async () => {},
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
