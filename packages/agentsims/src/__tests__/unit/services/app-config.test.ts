import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
	AppConfig,
	appConfigLayer,
	resolveAppConfig,
} from "../../../services/app-config";

describe("AppConfig", () => {
	test("resolves environment defaults behind one service", async () => {
		const config = await Effect.runPromise(
			resolveAppConfig(
				{},
				{
					HOST: "0.0.0.0",
					PORT: "3210",
				},
			),
		);

		expect(config).toEqual({
			host: "0.0.0.0",
			port: 3210,
			basePath: "/",
			codec: "auto",
			proxyHelpers: true,
		});
	});

	test("lets explicit adapter values override the environment", async () => {
		const config = await Effect.runPromise(
			resolveAppConfig(
				{
					host: "127.0.0.1",
					port: 4100,
					codec: "mjpeg",
				},
				{
					HOST: "0.0.0.0",
					PORT: "3210",
				},
			),
		);

		expect(config).toMatchObject({
			host: "127.0.0.1",
			port: 4100,
			codec: "mjpeg",
		});
	});

	test("rejects invalid environment ports", async () => {
		await expect(
			Effect.runPromise(resolveAppConfig({}, { PORT: "invalid" })),
		).rejects.toThrow("PORT must be an integer");
	});

	test("supports a stub layer without process environment mutation", async () => {
		const program = Effect.gen(function* () {
			return yield* AppConfig;
		}).pipe(Effect.provide(appConfigLayer({ port: 9000 }, {})));

		expect(await Effect.runPromise(program)).toMatchObject({ port: 9000 });
	});
});
