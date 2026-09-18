import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import type { Scope } from "effect/Scope";
import { androidSerialFromStateId } from "../../../core/android/device/identifiers";
import {
	AndroidSessions,
	type AndroidSessionsService,
} from "../../../core/android/session/session";
import {
	IosSessions,
	type IosSessionsService,
} from "../../../core/ios/session";
import { describeError, logRuntime } from "../../../core/logging";
import { ServerConfig } from "../../runtime/config";
import { HidSocketAdapter } from "../../websocket/hid-socket";
import { bytes, json, requestSource } from "./shared";

const mjpegFrame = (jpeg: Uint8Array) => {
	const header = Buffer.from(
		`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.byteLength}\r\n\r\n`,
		"ascii",
	);
	return Buffer.concat([
		header,
		Buffer.from(jpeg),
		Buffer.from("\r\n", "ascii"),
	]);
};

function subscriptionResponse(
	contentType: string,
	subscribe: (sink: {
		write(chunk: Uint8Array): Promise<void>;
	}) => Promise<() => void>,
	frame: (chunk: Uint8Array) => Uint8Array = (chunk) => chunk,
): Response {
	let closed = false;
	let unsubscribe: (() => void) | undefined;
	let writer: WritableStreamDefaultWriter<Uint8Array>;
	const stream = new TransformStream<Uint8Array, Uint8Array>(
		undefined,
		undefined,
		{
			highWaterMark: 1,
		},
	);
	writer = stream.writable.getWriter();
	void writer.closed
		.finally(() => {
			closed = true;
			unsubscribe?.();
		})
		.catch(() => {});
	void subscribe({ write: (chunk) => writer.write(frame(Buffer.from(chunk))) })
		.then((stop) => {
			unsubscribe = stop;
			if (closed) stop();
		})
		.catch((error) => writer.abort(error))
		.catch(() => {});
	return new Response(stream.readable, {
		headers: { "Content-Type": contentType, "Cache-Control": "no-store" },
	});
}

export function androidAvccResponse(
	serial: string,
	attach: (
		sink: import("../../../core/android/stream/transport").AvccSubscriberSink,
	) => Promise<() => void>,
): Response {
	let closed = false;
	let unsubscribe: (() => void) | undefined;
	const closeListeners = new Set<() => void>();
	const drainListeners = new Set<() => void>();
	let bufferedBytes = 0;
	const stream = new TransformStream<Uint8Array, Uint8Array>(
		undefined,
		undefined,
		{
			highWaterMark: 1,
		},
	);
	const writer = stream.writable.getWriter();
	void writer.closed
		.finally(() => {
			closed = true;
			unsubscribe?.();
			for (const listener of closeListeners) listener();
		})
		.catch(() => {});
	void attach({
		get closed() {
			return closed;
		},
		get bufferedBytes() {
			return bufferedBytes;
		},
		write: (chunk) => {
			bufferedBytes += chunk.byteLength;
			void writer.write(Buffer.from(chunk)).then(
				() => {
					bufferedBytes -= chunk.byteLength;
					for (const listener of drainListeners) listener();
				},
				() => {
					bufferedBytes -= chunk.byteLength;
				},
			);
		},
		close: () => {
			closed = true;
			void writer.close().catch(() => {});
		},
		onClose: (callback) => closeListeners.add(callback),
		onDrain: (callback) => drainListeners.add(callback),
	})
		.then(
			(stop) => {
				unsubscribe = stop;
				if (closed) stop();
			},
			(error) => {
				logDeviceFailure(`android:${serial}`, "stream.avcc", error);
				closed = true;
				return writer.close();
			},
		)
		.catch(() => {});
	return new Response(stream.readable, {
		headers: {
			"Content-Type": "application/octet-stream",
			"Cache-Control": "no-store",
		},
	});
}

/** Log a failure when it starts and when it ends, never once per retry. */
const recentFailures = new Map<string, { message: string; repeats: number }>();

export function logDeviceFailure(
	scope: string,
	endpoint: string,
	error: unknown,
): string {
	const message = describeError(error);
	const key = `${scope}/${endpoint}`;
	const previous = recentFailures.get(key);
	if (previous?.message === message) {
		previous.repeats += 1;
		return message;
	}
	recentFailures.set(key, { message, repeats: 0 });
	logRuntime(scope, `${endpoint} failed: ${message}`);
	return message;
}

export function clearDeviceFailure(scope: string, endpoint: string): void {
	const key = `${scope}/${endpoint}`;
	const previous = recentFailures.get(key);
	if (!previous) return;
	recentFailures.delete(key);
	logRuntime(
		scope,
		`${endpoint} recovered after ${previous.repeats + 1} failures`,
	);
}

function target(
	pathname: string,
	basePath: string,
): { device: string; endpoint: string } | null {
	const prefix = `${basePath}/helper/`;
	if (!pathname.startsWith(prefix)) return null;
	const parts = pathname.slice(prefix.length).split("/").filter(Boolean);
	if (parts.length < 2) return null;
	try {
		return {
			device: decodeURIComponent(parts[0]!),
			endpoint: parts.slice(1).join("/"),
		};
	} catch {
		return null;
	}
}

async function response(
	request: Request,
	device: string,
	endpoint: string,
	androidSessions: AndroidSessionsService,
	iosSessions: IosSessionsService,
): Promise<Response> {
	const url = new URL(request.url);
	const serial = androidSerialFromStateId(device);
	if (serial) {
		try {
			const session = await Effect.runPromise(androidSessions.get(serial));
			clearDeviceFailure(`android:${serial}`, endpoint);
			switch (endpoint) {
				case "stream.avcc":
					return androidAvccResponse(serial, (sink) =>
						session.attachAvccSink(sink),
					);
				case "stream.mjpeg":
					return json({ error: "Android MJPEG streaming is disabled" }, 410);
				case "screenshot.png":
					return bytes(await session.captureScreenshot(), "image/png");
				case "config":
					return json(await session.readConfig());
				case "health":
					return json({ status: "ok", platform: "android" });
				case "status":
				case "media":
					return json(await session.readStatus());
				case "ax": {
					const mode = url.searchParams.get("mode");
					return json(
						await session.readAccessibility(
							mode === "latest" || mode === "fresh" ? mode : "settled",
						),
					);
				}
				default:
					return new Response("No agentsims device endpoint", { status: 404 });
			}
		} catch (error) {
			const message = logDeviceFailure(`android:${serial}`, endpoint, error);
			return json({ error: message }, 503);
		}
	}
	try {
		const session = Effect.runSync(iosSessions.get(device));
		await session.start();
		switch (endpoint) {
			case "stream.mjpeg":
				return subscriptionResponse(
					url.searchParams.get("raw") === "1"
						? "application/octet-stream"
						: "multipart/x-mixed-replace; boundary=frame",
					(sink) => session.subscribeMjpeg(sink),
					url.searchParams.get("raw") === "1" ? undefined : mjpegFrame,
				);
			case "stream.avcc":
				return subscriptionResponse("application/octet-stream", (sink) =>
					session.subscribeAvcc(sink),
				);
			case "screenshot.png":
				{
					const screenshot = await session.captureScreenshot();
					return bytes(screenshot.bytes, screenshot.mimeType);
				}
			case "config":
				return json(session.screenConfig());
			case "health":
				return json({ status: "ok" });
			case "ax":
				return json(await session.readAccessibility());
			case "foreground":
				return json(await session.readForeground());
			default:
				return new Response("No agentsims device endpoint", { status: 404 });
		}
	} catch (error) {
		return json(
			{ error: error instanceof Error ? error.message : String(error) },
			503,
		);
	}
}

function upgrade(
	request: HttpServerRequest.HttpServerRequest,
	device: string,
): Effect.Effect<
	HttpServerResponse.HttpServerResponse,
	unknown,
	Scope | AndroidSessions | IosSessions
> {
	return Effect.gen(function* () {
		const androidSessions = yield* AndroidSessions;
		const iosSessions = yield* IosSessions;
		const socket = yield* request.upgrade;
		const write = yield* socket.writer;
		const adapter = new HidSocketAdapter(write);
		const serial = androidSerialFromStateId(device);
		if (serial) (yield* androidSessions.get(serial)).attachHidSocket(adapter);
		else {
			const session = yield* iosSessions.get(device);
			yield* Effect.promise(() => session.start());
			session.attachHidSocket(adapter);
		}
		yield* socket
			.run((data) => adapter.message(data))
			.pipe(
				Effect.ensuring(Effect.sync(() => adapter.emitClose())),
				Effect.catchAll(() => Effect.sync(() => adapter.emitError())),
			);
		return HttpServerResponse.empty();
	});
}

export const helperRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/helper/*",
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const androidSessions = yield* AndroidSessions;
			const iosSessions = yield* IosSessions;
			const serverRequest = yield* HttpServerRequest.HttpServerRequest;
			const request = requestSource(serverRequest.source);
			const match = target(new URL(request.url).pathname, config.basePath);
			if (!match)
				return HttpServerResponse.text("No agentsims device", { status: 404 });
			if (
				!androidSerialFromStateId(match.device) &&
				process.platform !== "darwin"
			)
				return HttpServerResponse.unsafeJson(
					{ error: "iOS Simulator requires a macOS server with Xcode." },
					{ status: 503 },
				);
			if (match.endpoint === "ws")
				return yield* upgrade(serverRequest, match.device);
			return HttpServerResponse.fromWeb(
				yield* Effect.promise(() =>
					response(
						request,
						match.device,
						match.endpoint,
						androidSessions,
						iosSessions,
					),
				),
			);
		}),
	),
);
