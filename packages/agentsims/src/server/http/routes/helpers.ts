import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import type { Scope } from "effect/Scope";
import { androidSerialFromStateId } from "../../../android/device/device";
import {
	AndroidSessions,
	type AndroidSessionsService,
} from "../../../android/session/session";
import {
	IosSessions,
	type IosSessionsService,
} from "../../../ios/session/session";
import { ServerConfig } from "../../runtime/server-config";
import { HidSocketAdapter } from "../../websocket/hid-socket";
import { bytes, json, requestSource } from "./shared";

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
			switch (endpoint) {
				case "stream.avcc":
					return session.avccResponse();
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
			return json(
				{ error: error instanceof Error ? error.message : String(error) },
				503,
			);
		}
	}
	try {
		const session = Effect.runSync(iosSessions.get(device));
		await session.start();
		switch (endpoint) {
			case "stream.mjpeg":
				return session.mjpegResponse(url.searchParams.get("raw") === "1");
			case "stream.avcc":
				return session.avccResponse();
			case "screenshot.png":
				return bytes(await session.captureScreenshot(), "image/jpeg");
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
			if (match.endpoint === "ws")
				return yield* upgrade(serverRequest, match.device);
			return HttpServerResponse.raw(
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
