import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { AgentLogger, logDebug } from "../../../shared/logger";

describe("AgentLogger", () => {
	test("supplies a stub layer without module mocking", async () => {
		const entries: unknown[] = [];
		const layer = Layer.succeed(AgentLogger, {
			log(namespace, formatter, ...args) {
				entries.push({ namespace, formatter, args });
			},
		});

		await Effect.runPromise(
			logDebug("state", "device=%s", "ios-device").pipe(Effect.provide(layer)),
		);

		expect(entries).toEqual([
			{
				namespace: "state",
				formatter: "device=%s",
				args: ["ios-device"],
			},
		]);
	});
});
