import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
} from "@effect/platform";
import { Effect } from "effect";
import { Contexts } from "../../../core/tools/context/context";
import { ContextError } from "../../../core/tools/context/contracts";
import {
	contextWorkspace,
	parseContextInput,
} from "../../../core/tools/context/input";
import {
	exportContext,
	summarizeContext,
} from "../../../core/tools/context/export";
import {
	ContextImageExportError,
	exportContextImages,
} from "../../../core/tools/context/image-export";
import { json, requestSource } from "./shared";

const MAX_BODY = 12 * 1024 * 1024;
const request = Effect.map(HttpServerRequest.HttpServerRequest, (value) =>
	requestSource(value.source),
);
const input = <T>(run: () => T) =>
	Effect.try({
		try: run,
		catch: (error) =>
			error instanceof ContextError
				? error
				: new ContextError("invalid", "Invalid context request."),
	});
const response = <A, R>(
	operation: Effect.Effect<A, ContextError | ContextImageExportError, R>,
) =>
	operation.pipe(
		Effect.map((value) => HttpServerResponse.raw(json(value))),
		Effect.catchAll((error) =>
			Effect.succeed(
				HttpServerResponse.raw(
					json(
						{ error: error.message, code: error.code },
						error.code === "export"
							? 500
							: error.code === "missing"
								? 404
								: error.code === "limit"
									? 413
									: error.code === "closed"
										? 410
										: 400,
					),
				),
			),
		),
	);

function body(request: Request) {
	return Effect.tryPromise({
		try: async () => {
			const length = Number(request.headers.get("content-length"));
			let oversized = length > MAX_BODY;
			if (!request.body)
				throw new ContextError("invalid", "Missing context request.");
			const reader = request.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const part = await reader.read();
					if (part.done) break;
					size += part.value.byteLength;
					if (size > MAX_BODY) {
						oversized = true;
						chunks.length = 0;
					}
					// Drain rejected uploads without retaining them. Bun otherwise
					// leaves a reused connection waiting on its unread request body.
					if (!oversized) chunks.push(part.value);
				}
			} finally {
				reader.releaseLock();
			}
			if (oversized)
				throw new ContextError("limit", "Context request exceeds 12 MiB.");
			return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
				string,
				unknown
			>;
		},
		catch: (error) =>
			error instanceof ContextError
				? error
				: new ContextError("invalid", "Invalid context JSON."),
	});
}

const queryWorkspace = (request: Request) =>
	input(() =>
		contextWorkspace(new URL(request.url).searchParams.get("workspace")),
	);
const itemId = Effect.flatMap(HttpRouter.RouteContext, (value) =>
	input(() => {
		const id = value.params.id;
		if (!id || id.length > 256)
			throw new ContextError("invalid", "Context ID is required.");
		return id;
	}),
);

export const contextRoutes = HttpRouter.empty.pipe(
	HttpRouter.get(
		"/context",
		response(
			Effect.gen(function* () {
				const req = yield* request;
				const items = yield* (yield* Contexts).list(
					yield* queryWorkspace(req),
					new URL(req.url).searchParams.get("device") ?? undefined,
				);
				return items.map(summarizeContext);
			}),
		),
	),
	HttpRouter.post(
		"/context",
		response(
			Effect.gen(function* () {
				const value = yield* body(yield* request);
				const workspace = yield* input(() => contextWorkspace(value.workspace));
				const evidence = yield* input(() => parseContextInput(value.input));
				const requestId = yield* input(() => {
					if (
						value.requestId !== undefined &&
						typeof value.requestId !== "string"
					)
						throw new ContextError("invalid", "Invalid request ID.");
					return value.requestId as string | undefined;
				});
				return summarizeContext(
					yield* (yield* Contexts).createDraft(workspace, evidence, requestId),
				);
			}),
		),
	),
	HttpRouter.post(
		"/context/export",
		response(
			Effect.gen(function* () {
				const value = yield* body(yield* request);
				const workspace = yield* input(() => contextWorkspace(value.workspace));
				const ids = yield* input(() => {
					if (
						!Array.isArray(value.ids) ||
						!value.ids.length ||
						value.ids.length > 32 ||
						value.ids.some((id) => typeof id !== "string" || id.length > 256)
					)
						throw new ContextError(
							"invalid",
							"Select between 1 and 32 context items.",
						);
					return [...new Set(value.ids as string[])];
				});
				const contexts = yield* Contexts;
				const items = yield* Effect.all(
					ids.map((id) => contexts.get(workspace, id)),
				);
				return exportContext(items);
			}),
		),
	),
	HttpRouter.post(
		"/context/export-images",
		response(
			Effect.gen(function* () {
				const value = yield* body(yield* request);
				return yield* exportContextImages(value?.workspace, value?.ids);
			}),
		),
	),
	HttpRouter.get(
		"/context/:id/image",
		Effect.gen(function* () {
			const item = yield* (yield* Contexts).get(
				yield* queryWorkspace(yield* request),
				yield* itemId,
			);
			if (item.kind !== "annotation")
				return yield* Effect.fail(
					new ContextError("missing", "Image evidence is unavailable."),
				);
			return HttpServerResponse.raw(
				new Response(Buffer.from(item.image.base64, "base64"), {
					headers: {
						"Content-Type": item.image.mimeType,
						"Cache-Control": "no-store",
					},
				}),
			);
		}).pipe(
			Effect.catchAll((error) =>
				Effect.succeed(
					HttpServerResponse.raw(
						json(
							{ error: error.message, code: error.code },
							error.code === "missing" ? 404 : 400,
						),
					),
				),
			),
		),
	),
	HttpRouter.get(
		"/context/:id",
		response(
			Effect.gen(function* () {
				return summarizeContext(
					yield* (yield* Contexts).get(
						yield* queryWorkspace(yield* request),
						yield* itemId,
					),
				);
			}),
		),
	),
	HttpRouter.patch(
		"/context/:id",
		response(
			Effect.gen(function* () {
				const value = yield* body(yield* request);
				const workspace = yield* input(() => contextWorkspace(value.workspace));
				const note = yield* input(() => {
					if (typeof value.note !== "string")
						throw new ContextError("invalid", "Note is required.");
					return value.note;
				});
				return summarizeContext(
					yield* (yield* Contexts).updateNote(workspace, yield* itemId, note),
				);
			}),
		),
	),
	HttpRouter.post(
		"/context/:id/save",
		response(
			Effect.gen(function* () {
				const value = yield* body(yield* request);
				return summarizeContext(
					yield* (yield* Contexts).save(
						yield* input(() => contextWorkspace(value.workspace)),
						yield* itemId,
					),
				);
			}),
		),
	),
	HttpRouter.del(
		"/context/:id",
		response(
			Effect.gen(function* () {
				return {
					removed: yield* (yield* Contexts).remove(
						yield* queryWorkspace(yield* request),
						yield* itemId,
					),
				};
			}),
		),
	),
);
