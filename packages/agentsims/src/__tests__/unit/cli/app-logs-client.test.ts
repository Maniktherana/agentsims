import { expect, test } from "bun:test";
import {
	ApplicationCommandClient,
	CommandRequestError,
} from "../../../cli/application-command-client";
import type { LogEvent, LogTarget } from "../../../core/tools/logs/contracts";

const target: LogTarget = {
	device: "android:emulator-5554",
	app: { mode: "foreground" },
};
const query = { device: target.device, limit: 100 };
const event: LogEvent = {
	type: "status",
	status: {
		device: target.device,
		source: "android-native",
		state: "live",
		reason: "Ready 🙂",
	},
};

async function fixture(
	fetch: (request: Request) => Response,
	run: (client: ApplicationCommandClient) => Promise<void>,
) {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
	try {
		await run(
			new ApplicationCommandClient({
				origin: server.url.origin,
				timeoutMs: 1000,
			}),
		);
	} finally {
		await server.stop(true);
	}
}

test("application log streams decode split UTF-8, comments, and multiline SSE data", async () => {
	const encoder = new TextEncoder();
	const payload = `: heartbeat\r\n\r\ndata: ${JSON.stringify(event).replace(',"status"', ',\r\ndata: "status"')}\r\n\r\n`;
	const bytes = encoder.encode(payload);
	const split = bytes.indexOf(0xf0) + 1;
	await fixture(
		(request) => {
			expect(new URL(request.url).searchParams.get("device")).toBe(
				target.device,
			);
			return new Response(
				new ReadableStream({
					async start(controller) {
						controller.enqueue(bytes.slice(0, split));
						await Bun.sleep(5);
						controller.enqueue(bytes.slice(split));
						controller.close();
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
		async (client) => {
			const received = [];
			for await (const item of client.streamAppLogs(target, query))
				received.push(item);
			expect(received).toEqual([event]);
		},
	);
});

test("application log cancellation ends the reader without a hidden reconnect", async () => {
	let connections = 0;
	await fixture(
		() => {
			connections++;
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`),
						);
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		},
		async (client) => {
			const controller = new AbortController();
			const iterator = client
				.streamAppLogs(target, query, controller.signal)
				[Symbol.asyncIterator]();
			expect((await iterator.next()).value).toEqual(event);
			controller.abort();
			expect((await iterator.next()).done).toBe(true);
			expect(connections).toBe(1);
		},
	);
});

test("late log failures preserve the server error type", async () => {
	await fixture(
		() =>
			new Response(
				'event: failure\ndata: {"error":"Collector unavailable","type":"CommandUnavailable"}\n\n',
				{ headers: { "content-type": "text/event-stream" } },
			),
		async (client) => {
			try {
				for await (const _event of client.streamAppLogs(target, query))
					throw new Error("Unexpected event");
				throw new Error("Expected a stream failure");
			} catch (error) {
				expect(error).toBeInstanceOf(CommandRequestError);
				expect((error as CommandRequestError).type).toBe("CommandUnavailable");
			}
		},
	);
});

test.each(["data: {", `data: ${JSON.stringify(event)}`])(
	"an incomplete SSE event fails visibly",
	async (payload) => {
		await fixture(
			() =>
				new Response(payload, {
					headers: { "content-type": "text/event-stream" },
				}),
			async (client) => {
				await expect(async () => {
					for await (const _event of client.streamAppLogs(target, query)) {
						/* The response has no complete event. */
					}
				}).toThrow("ended during an event");
			},
		);
	},
);

test("an oversized SSE event is rejected before parsing", async () => {
	await fixture(
		() =>
			new Response("data: " + "x".repeat(8 * 1024 * 1024), {
				headers: { "content-type": "text/event-stream" },
			}),
		async (client) => {
			await expect(async () => {
				for await (const _event of client.streamAppLogs(target, query)) {
					/* The rejected event cannot be yielded. */
				}
			}).toThrow("exceeds 8 MiB");
		},
	);
});
