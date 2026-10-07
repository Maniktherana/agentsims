import { expect, test } from "bun:test";
import { HttpApp, HttpRouter } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { ConfigProvider, Effect, Stream } from "effect";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ApplicationLogs } from "../../core/tools/logs/application";
import { logsRoutes } from "../../server/http/routes/logs";

async function fixture() {
	const home = await mkdtemp(join(tmpdir(), "agentsims-log-export-"));
	const http = Effect.runSync(HttpRouter.toHttpApp(logsRoutes)).pipe(
		Effect.provideService(ApplicationLogs, {
			snapshot: () => Effect.die("Export must use saved browser history."),
			openStream: () => Effect.die("Export must not open a collector."),
			stream: () => Stream.die("Export must not open a collector."),
		}),
		Effect.provide(BunContext.layer),
		Effect.withConfigProvider(
			ConfigProvider.fromMap(new Map([["HOME", home]])),
		),
	);
	const handler = HttpApp.toWebHandler(http);
	return {
		home,
		post: (value: unknown, origin = "http://localhost:3200") =>
			handler(
				new Request("http://localhost:3200/logs/export", {
					method: "POST",
					headers: { "Content-Type": "application/json", Origin: origin },
					body: JSON.stringify(value),
				}),
			),
		close: () => rm(home, { recursive: true, force: true }),
	};
}

test("log download atomically saves complete captured text without reading a device", async () => {
	const server = await fixture();
	try {
		const text =
			"iPhone: app error 🌍\n    at screen.ts:42\nPixel: app message" +
			"\nmessage 🌍".repeat(100_000);
		const paths: string[] = [];
		for (let index = 0; index < 2; index++) {
			const response = await server.post({
				name: "../All devices",
				text,
				path: "/must-not-control-the-destination",
			});
			expect(response.status).toBe(200);
			const receipt = (await response.json()) as { path: string };
			expect(dirname(receipt.path)).toBe(join(server.home, "Downloads"));
			expect(receipt.path.endsWith(".txt")).toBe(true);
			expect(await readFile(receipt.path, "utf8")).toBe(text);
			paths.push(receipt.path);
		}
		expect(paths[0]).not.toBe(paths[1]);
		expect(await readdir(join(server.home, "Downloads"))).toHaveLength(2);
	} finally {
		await server.close();
	}
});

test("invalid, cross-origin, and oversized log exports cannot write files", async () => {
	const server = await fixture();
	try {
		for (const value of [
			null,
			{},
			{ name: 42, text: "log" },
			{ name: "phone", text: "" },
			{ name: "phone", text: "🌍".repeat(2 * 1024 * 1024 + 1) },
		]) {
			expect((await server.post(value)).status).toBe(400);
		}
		expect(
			(
				await server.post(
					{ name: "phone", text: "log" },
					"https://other.example",
				)
			).status,
		).toBe(400);
		expect(await readdir(server.home)).toEqual([]);
	} finally {
		await server.close();
	}
});
