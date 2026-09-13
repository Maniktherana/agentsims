import { expect, test } from "bun:test";
import { HttpServer } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime } from "effect";
import { httpApplicationLive } from "../../server/http/server";
import { ServerConfig, serverConfigLayer } from "../../server/runtime/config";

test("an ephemeral preview reports its bound port to device routes", async () => {
	const config = serverConfigLayer({
		host: "127.0.0.1",
		port: 0,
		basePath: "/.sim",
		proxyHelpers: true,
		previewRoot: "/unused",
		execToken: "test",
		agentsimsBin: "agentsims",
	});
	const runtime = ManagedRuntime.make(
		httpApplicationLive("127.0.0.1", 0).pipe(
			Layer.provideMerge(config),
			Layer.provide(BunContext.layer),
		),
	);
	try {
		const result = await runtime.runPromise(
			Effect.gen(function* () {
				const server = yield* HttpServer.HttpServer;
				const configuration = yield* ServerConfig;
				return {
					address: server.address,
					port: configuration.port,
					basePath: configuration.basePath,
				};
			}),
		);
		expect(result.address._tag).toBe("TcpAddress");
		expect(result.port).toBeGreaterThan(0);
		if (result.address._tag === "TcpAddress")
			expect(result.port).toBe(result.address.port);
		expect(result.basePath).toBe("/.sim");
	} finally {
		await runtime.dispose();
	}
});
