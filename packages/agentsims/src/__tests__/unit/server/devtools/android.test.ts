import { expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import {
	AndroidCdpAdapter,
	AndroidDevTools,
	AndroidDevToolsLive,
} from "../../../../server/devtools/android";

test("forwards Android Chrome CDP and removes the forward with its Layer", async () => {
	const commands: Array<{ serial: string; args: readonly string[] }> = [];
	const AdapterTest = Layer.succeed(AndroidCdpAdapter, {
		command: (serial, args) =>
			Effect.sync(() => {
				commands.push({ serial, args });
				return args.includes("--remove") ? "" : "50993\n";
			}),
		targets: () =>
			Effect.succeed([
				{
					id: "page-1",
					title: "Example",
					url: "https://example.test",
					type: "page",
					webSocketDebuggerUrl: "ws://localhost:9222/devtools/page/page-1",
				},
			]),
	});
	const program = Effect.gen(function* () {
		const provider = yield* AndroidDevTools;
		const targets = yield* provider.list("android:emulator-5554");
		expect(targets).toHaveLength(1);
		expect(targets[0]?.webSocketUrl).toBe(
			"ws://127.0.0.1:50993/devtools/page/page-1",
		);
	}).pipe(Effect.provide(AndroidDevToolsLive.pipe(Layer.provide(AdapterTest))));

	await Effect.runPromise(program);
	expect(commands).toEqual([
		{
			serial: "emulator-5554",
			args: ["forward", "tcp:0", "localabstract:chrome_devtools_remote"],
		},
		{
			serial: "emulator-5554",
			args: ["forward", "--remove", "tcp:50993"],
		},
	]);
});
