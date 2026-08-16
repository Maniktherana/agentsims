import {
	FileSystem,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Option, Schedule, Stream } from "effect";
import {
	HttpRuntime,
	type HttpRuntimeService,
} from "../../../services/http-runtime";
import {
	previewAssetContentType,
	previewAssetKeyForRequest,
	resolvePreviewAsset,
} from "../../preview/preview-assets";
import { json, previewConfig, requestSource, selectedState } from "./shared";

function previewAssetResponse(
	assetKey: string,
	content: Uint8Array,
	basePath: string,
): Response {
	const body: string | Uint8Array<ArrayBuffer> = assetKey.endsWith(".css")
		? Buffer.from(content)
				.toString("utf8")
				.replaceAll("/__SIM_PREVIEW_BASE__", basePath)
		: new Uint8Array(content);
	return new Response(body, {
		headers: {
			"Content-Type": previewAssetContentType(assetKey),
			"Cache-Control": assetKey.endsWith(".css")
				? "no-store"
				: "public, max-age=31536000, immutable",
		},
	});
}

function staticResponse(request: Request, runtime: HttpRuntimeService) {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const url = new URL(request.url);
		const rawUrl = `${url.pathname}${url.search}`;
		const assetKey = previewAssetKeyForRequest(rawUrl, runtime.basePath);
		const embedded = runtime.previewAssets
			? resolvePreviewAsset(rawUrl, runtime.basePath, runtime.previewAssets)
			: null;
		if (embedded === false || assetKey === "")
			return new Response("Preview asset not found", { status: 404 });
		if (embedded) {
			return previewAssetResponse(
				assetKey!,
				Buffer.from(embedded.contentBase64, "base64"),
				runtime.basePath,
			);
		}
		if (assetKey) {
			const path = `${runtime.previewRoot}/${assetKey}`;
			if (!(yield* fileSystem.exists(path))) {
				return new Response("Preview asset not found", { status: 404 });
			}
			return previewAssetResponse(
				assetKey,
				yield* fileSystem.readFile(path),
				runtime.basePath,
			);
		}
		const isRoot =
			url.pathname === runtime.basePath ||
			url.pathname === `${runtime.basePath}/` ||
			(runtime.basePath === "" && url.pathname === "/");
		if (!isRoot) return null;
		const state = yield* selectedState(url, runtime);
		let html = yield* fileSystem.readFileString(
			`${runtime.previewRoot}/index.html`,
		);
		html = html.replaceAll("/__SIM_PREVIEW_BASE__", runtime.basePath);
		html = html.replace(
			/(href="[^"]+\.css)"/g,
			`$1?v=${encodeURIComponent(runtime.execToken)}"`,
		);
		const config = state
			? previewConfig(request, runtime, state)
			: { basePath: runtime.basePath, execToken: runtime.execToken };
		html = html.replace(
			"<!--__SIM_PREVIEW_CONFIG__-->",
			`<script>window.__SIM_PREVIEW__=${JSON.stringify(config)}</script>`,
		);
		return new Response(html, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
			},
		});
	});
}

const previewHandler = Effect.gen(function* () {
	const runtime = yield* HttpRuntime;
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return HttpServerResponse.raw(
		(yield* staticResponse(request, runtime)) ??
			new Response("Not found", { status: 404 }),
	);
});

const sseEncoder = new TextEncoder();
const ssePollSchedule = Schedule.spaced("500 millis");

function pollingSse(values: Effect.Effect<Option.Option<string>>) {
	const updates = Stream.repeatEffectWithSchedule(values, ssePollSchedule).pipe(
		Stream.filterMap((value) => value),
		Stream.changes,
		Stream.map((value) => sseEncoder.encode(`data: ${value}\n\n`)),
	);
	return HttpServerResponse.stream(
		Stream.succeed(sseEncoder.encode(":\n\n")).pipe(Stream.concat(updates)),
		{
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				"X-Accel-Buffering": "no",
			},
		},
	);
}

export const previewRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/api",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const state = yield* selectedState(new URL(request.url), runtime);
			return HttpServerResponse.raw(
				state
					? json(previewConfig(request, runtime, state))
					: json({ error: "No agentsims device" }, 404),
			);
		}),
	),
	HttpRouter.get(
		"/api/events",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			return pollingSse(
				selectedState(url, runtime).pipe(
					Effect.map((state) =>
						Option.fromNullable(
							state
								? JSON.stringify(previewConfig(request, runtime, state))
								: null,
						),
					),
				),
			);
		}),
	),
	HttpRouter.get(
		"/appstate",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const state = yield* selectedState(new URL(request.url), runtime);
			if (!state)
				return HttpServerResponse.text("No agentsims device", { status: 404 });
			const readForeground = runtime
				.foregroundApp(state.device)
				.pipe(
					Effect.map((value) =>
						Option.fromNullable(value ? JSON.stringify(value) : null),
					),
				);
			return pollingSse(readForeground);
		}),
	),
	HttpRouter.get("/", previewHandler),
	HttpRouter.get("/*", previewHandler),
);
