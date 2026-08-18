import {
	FileSystem,
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect, Option, Schedule, Stream } from "effect";
import { ForegroundApps } from "../../devices/foreground-apps";
import { DeviceLifecycleService } from "../../devices/device-lifecycle";
import {
	ServerConfig,
	type ServerConfigValue,
} from "../../runtime/server-config";
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

function staticResponse(
	request: Request,
	config: ServerConfigValue,
	lifecycle: typeof DeviceLifecycleService.Service,
) {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const url = new URL(request.url);
		const rawUrl = `${url.pathname}${url.search}`;
		const assetKey = previewAssetKeyForRequest(rawUrl, config.basePath);
		const embedded = config.previewAssets
			? resolvePreviewAsset(rawUrl, config.basePath, config.previewAssets)
			: null;
		if (embedded === false || assetKey === "")
			return new Response("Preview asset not found", { status: 404 });
		if (embedded) {
			return previewAssetResponse(
				assetKey!,
				Buffer.from(embedded.contentBase64, "base64"),
				config.basePath,
			);
		}
		if (assetKey) {
			const path = `${config.previewRoot}/${assetKey}`;
			if (!(yield* fileSystem.exists(path))) {
				return new Response("Preview asset not found", { status: 404 });
			}
			return previewAssetResponse(
				assetKey,
				yield* fileSystem.readFile(path),
				config.basePath,
			);
		}
		const isRoot =
			url.pathname === config.basePath ||
			url.pathname === `${config.basePath}/` ||
			(config.basePath === "" && url.pathname === "/");
		if (!isRoot) return null;
		const states = yield* Effect.promise(() => lifecycle.states());
		const state = selectedState(url, config, states);
		let html = yield* fileSystem.readFileString(
			`${config.previewRoot}/index.html`,
		);
		html = html.replaceAll("/__SIM_PREVIEW_BASE__", config.basePath);
		html = html.replace(
			/(href="[^"]+\.css)"/g,
			`$1?v=${encodeURIComponent(config.execToken)}"`,
		);
		const preview = state
			? previewConfig(request, config, state)
			: { basePath: config.basePath, execToken: config.execToken };
		html = html.replace(
			"<!--__SIM_PREVIEW_CONFIG__-->",
			`<script>window.__SIM_PREVIEW__=${JSON.stringify(preview)}</script>`,
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
	const config = yield* ServerConfig;
	const lifecycle = yield* DeviceLifecycleService;
	const request = requestSource(
		(yield* HttpServerRequest.HttpServerRequest).source,
	);
	return HttpServerResponse.raw(
		(yield* staticResponse(request, config, lifecycle)) ??
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
			const config = yield* ServerConfig;
			const lifecycle = yield* DeviceLifecycleService;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const states = yield* Effect.promise(() => lifecycle.states());
			const state = selectedState(new URL(request.url), config, states);
			return HttpServerResponse.raw(
				state
					? json(previewConfig(request, config, state))
					: json({ error: "No agentsims device" }, 404),
			);
		}),
	),
	HttpRouter.get(
		"/api/events",
		Effect.gen(function* () {
			const config = yield* ServerConfig;
			const lifecycle = yield* DeviceLifecycleService;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			return pollingSse(
				Effect.promise(() => lifecycle.states()).pipe(
					Effect.map((states) => selectedState(url, config, states)),
					Effect.map((state) =>
						Option.fromNullable(
							state
								? JSON.stringify(previewConfig(request, config, state))
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
			const config = yield* ServerConfig;
			const lifecycle = yield* DeviceLifecycleService;
			const foregroundApps = yield* ForegroundApps;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const states = yield* Effect.promise(() => lifecycle.states());
			const state = selectedState(new URL(request.url), config, states);
			if (!state)
				return HttpServerResponse.text("No agentsims device", { status: 404 });
			const readForeground = foregroundApps
				.read(state.device)
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
