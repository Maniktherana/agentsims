import { expect, test } from "bun:test";
import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import {
	AndroidSessions,
	type AndroidSessionsService,
} from "../../../../../core/android/session/session";
import {
	DeviceSession,
	IosSessions,
} from "../../../../../core/ios/session";
import {
	androidAvccResponse,
	helperRoutes,
} from "../../../../../server/http/routes/helpers";
import { ServerConfig } from "../../../../../server/runtime/config";

test("Android stream responses do not wait for capture startup", async () => {
	let finishStartup: ((unsubscribe: () => void) => void) | undefined;
	const startup = new Promise<() => void>((resolve) => {
		finishStartup = resolve;
	});

	const response = androidAvccResponse("emulator-5554", () => startup);
	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("application/octet-stream");

	finishStartup?.(() => {});
	await response.body?.cancel();
});

test("the iOS screenshot endpoint keeps JPEG bytes and MIME type", async () => {
	const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
	const session = {
		start: async () => {},
		captureScreenshot: async () => ({
			sequence: 7,
			width: 100,
			height: 200,
			bytes: jpeg,
			mimeType: "image/jpeg" as const,
			capturedAt: 1_234,
		}),
	} as DeviceSession;
	const androidSessions: AndroidSessionsService = {
		get: () => Effect.die("not used"),
		close: () => Effect.void,
	};
	const app = Effect.runSync(HttpRouter.toHttpApp(helperRoutes));
	const request = HttpServerRequest.fromWeb(
		new Request("http://127.0.0.1/helper/ios-device/screenshot.png"),
	);
	const result = await Effect.runPromise(
		app.pipe(
			Effect.provideService(HttpServerRequest.HttpServerRequest, request),
			Effect.provideService(ServerConfig, {
				basePath: "",
				host: "127.0.0.1",
				port: 0,
				proxyHelpers: true,
				previewRoot: "",
				execToken: "test",
				agentsimsBin: "agentsims",
			}),
			Effect.provideService(AndroidSessions, androidSessions),
			Effect.provideService(IosSessions, {
				get: () => Effect.succeed(session),
				close: () => Effect.void,
			}),
		),
	);
	const response = HttpServerResponse.toWeb(result);

	expect(response.status).toBe(200);
	expect(response.headers.get("content-type")).toBe("image/jpeg");
	expect(Buffer.from(await response.arrayBuffer())).toEqual(jpeg);
});
