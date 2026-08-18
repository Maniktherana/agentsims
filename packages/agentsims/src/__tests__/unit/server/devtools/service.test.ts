import { BunContext } from "@effect/platform-bun";
import { Layer } from "effect";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
	WebKitDevTools,
	webKitDevToolsLayer,
} from "../../../../server/devtools/webkit";

test("the WebKit bridge starts lazily and closes with its Layer", async () => {
	let starts = 0;
	let closes = 0;
	const layer = webKitDevToolsLayer(async () => {
		starts += 1;
		return {
			port: 9222,
			cdpUrl: "http://127.0.0.1:9222",
			listTargets: async () => [
				{
					id: "page-1",
					title: "Example",
					url: "https://example.test",
					type: "page",
					udid: "ios-device",
				},
			],
			close: () => {
				closes += 1;
			},
		};
	});
	const program = Effect.gen(function* () {
		const provider = yield* WebKitDevTools;
		expect(starts).toBe(0);
		expect(yield* provider.list("ios-device")).toHaveLength(1);
		yield* provider.list("ios-device");
		expect(starts).toBe(1);
	}).pipe(Effect.provide(layer.pipe(Layer.provide(BunContext.layer))));

	await Effect.runPromise(program);
	expect(closes).toBe(1);
});
