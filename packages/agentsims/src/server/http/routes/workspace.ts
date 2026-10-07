import { HttpRouter, HttpServerRequest, HttpServerResponse } from "@effect/platform";
import { Effect, Stream } from "effect";
import { z } from "zod";
import { WorkspaceSessions } from "../../../core/tools/workspace/service";
import { WORKSPACE_LIMITS, WorkspaceError } from "../../../core/tools/workspace/contracts";
import { requestSource } from "./shared";

const id = z.uuid();
const leaseInput = z.object({ device: z.string().min(1).max(256), codec: z.enum(["avcc", "jpeg"]).default("avcc") }).strict();
const copyInput = z.object({ viewId: id, bytes: z.number().int().min(0).max(WORKSPACE_LIMITS.connectionBytes) }).strict();
const fail = (error: unknown) => error instanceof WorkspaceError ? error : new WorkspaceError("invalid", "Use a valid workspace request.");
const parse = <A>(run: () => A) => Effect.try({ try: run, catch: fail });
const request = Effect.flatMap(HttpServerRequest.HttpServerRequest, (value) => parse(() => {
	const source = requestSource(value.source);
	const origin = source.headers.get("Origin");
	if (origin !== null && (origin === "null" || new URL(origin).origin !== new URL(source.url).origin))
		throw new WorkspaceError("invalid", "Cross-origin request blocked.");
	return source;
}));
const parameters = Effect.flatMap(HttpRouter.RouteContext, (value) => parse(() => ({
	workspace: id.parse(value.params.workspace),
	viewId: value.params.viewId === undefined ? undefined : id.parse(value.params.viewId),
	leaseId: value.params.leaseId === undefined ? undefined : id.parse(value.params.leaseId),
	reservationId: value.params.reservationId === undefined ? undefined : id.parse(value.params.reservationId),
})));
function body(source: Request) {
	return Effect.tryPromise({
		try: async (signal) => {
			if (!source.headers.get("Content-Type")?.startsWith("application/json") || !source.body)
				throw new WorkspaceError("invalid", "Send workspace input as JSON.");
			const reader = source.body.getReader(), chunks: Uint8Array[] = [];
			let size = 0;
			const aborted = () => { void reader.cancel(); };
			signal.addEventListener("abort", aborted, { once: true });
			try {
				for (;;) {
					const next = await reader.read();
					if (next.done) break;
					size += next.value.length;
					if (size > WORKSPACE_LIMITS.inputBytes) { await reader.cancel(); throw new WorkspaceError("bounds", "Workspace input exceeds 16 KiB."); }
					chunks.push(next.value);
				}
				if (size > WORKSPACE_LIMITS.inputBytes) throw new WorkspaceError("bounds", "Workspace input exceeds 16 KiB.");
				return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
			} finally { signal.removeEventListener("abort", aborted); reader.releaseLock(); }
		}, catch: fail,
	});
}
const response = <A, E, R>(operation: Effect.Effect<A, E, R>) => operation.pipe(
	Effect.catchAll((cause) => {
		const error = fail(cause);
		const status = error.code === "closed" ? 410 : error.code === "bounds" ? 413 : error.code === "busy" || error.code === "stale" ? 409 : error.code === "unavailable" ? 503 : 400;
		return Effect.succeed(HttpServerResponse.unsafeJson({ error: error.message, code: error.code, type: "WorkspaceError" }, { status, headers: { "Cache-Control": "no-store" } }));
	}),
);
const json = <A, E, R>(operation: Effect.Effect<A, E, R>) => response(operation.pipe(
	Effect.map((value) => HttpServerResponse.unsafeJson(value, { headers: { "Cache-Control": "no-store" } })),
));
const scope = Effect.gen(function* () {
	yield* request;
	return { ...yield* parameters, service: yield* WorkspaceSessions };
});

export const workspaceRoutes = HttpRouter.empty.pipe(
	HttpRouter.post("/workspace", json(Effect.gen(function* () { yield* request; return yield* (yield* WorkspaceSessions).createWorkspace(); }))),
	HttpRouter.put("/workspace/:workspace", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.renewWorkspace(s.workspace); }))),
	HttpRouter.del("/workspace/:workspace", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.closeWorkspace(s.workspace); }))),
	HttpRouter.post("/workspace/:workspace/views", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.openView(s.workspace); }))),
	HttpRouter.del("/workspace/:workspace/views/:viewId", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.closeView(s.workspace, s.viewId!); }))),
	HttpRouter.post("/workspace/:workspace/views/:viewId/leases", json(Effect.gen(function* () {
		const s = yield* scope, value = yield* body(yield* request);
		const input = yield* parse(() => leaseInput.parse(value));
		return yield* s.service.open(s.workspace, s.viewId!, input.device, input.codec);
	}))),
	HttpRouter.get("/workspace/:workspace/views/:viewId/leases/:leaseId/config", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.config(s.workspace, s.viewId!, s.leaseId!); }))),
	HttpRouter.post("/workspace/:workspace/views/:viewId/leases/:leaseId/input", json(Effect.gen(function* () {
		const s = yield* scope, value = yield* body(yield* request);
		if (!value || typeof value !== "object" || (value as { leaseId?: string }).leaseId !== s.leaseId)
			return yield* Effect.fail(new WorkspaceError("invalid", "Workspace input belongs to another lease."));
		return yield* s.service.input(s.workspace, s.viewId!, value);
	}))),
	HttpRouter.del("/workspace/:workspace/views/:viewId/leases/:leaseId", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.close(s.workspace, s.viewId!, s.leaseId!); }))),
	HttpRouter.get("/workspace/:workspace/views/:viewId/leases/:leaseId/video", response(Effect.gen(function* () {
		const s = yield* scope, source = yield* request, query = new URL(source.url).searchParams;
		const number = (name: string, minimum: number) => {
			const values = query.getAll(name), value = values[0];
			if (value === undefined) return undefined;
			if (values.length !== 1) throw new WorkspaceError("invalid", "Use one workspace video cursor and epoch.");
			if (!/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < minimum)
				throw new WorkspaceError("invalid", "Use a valid workspace video cursor and epoch.");
			return Number(value);
		};
		const options = yield* parse(() => ({ cursor: number("cursor", 0), epoch: number("epoch", 1), signal: source.signal }));
		if ([...query.keys()].some((name) => !["cursor", "epoch", "retain"].includes(name)) || query.getAll("retain").length > 1 || (query.has("retain") && query.get("retain") !== "1")) return yield* Effect.fail(new WorkspaceError("invalid", "Use a valid workspace video query."));
		const delivery = yield* s.service.read(s.workspace, s.viewId!, s.leaseId!, options);
		let completed = false;
		const retained = query.get("retain") === "1" ? yield* Effect.acquireRelease(
			s.service.retainBytes(s.workspace, s.viewId!, delivery.bytes.length * 2),
			(value) => completed ? Effect.void : s.service.releaseReservation(s.workspace, value.reservationId).pipe(Effect.orElseSucceed(() => undefined)),
		) : undefined;
		const stream = Stream.succeed(delivery.bytes).pipe(Stream.concat(Stream.fromEffect(Effect.sync(() => { completed = true; })).pipe(Stream.drain)));
		return HttpServerResponse.stream(stream, {
			headers: {
				"Content-Type": delivery.mimeType, "Content-Length": String(delivery.bytes.length), "Cache-Control": "no-store",
				"X-Agentsims-Workspace": delivery.workspace, "X-Agentsims-View": delivery.viewId, "X-Agentsims-Lease": delivery.leaseId,
				"X-Agentsims-Device": encodeURIComponent(delivery.device), "X-Agentsims-Cursor": String(delivery.cursor),
				"X-Agentsims-Epoch": String(delivery.epoch), "X-Agentsims-Reset": delivery.reset ? "1" : "0",
				...(retained ? { "X-Agentsims-Reservation": retained.reservationId } : {}),
			},
		});
	}))),
	HttpRouter.put("/workspace/:workspace/reservations/:reservationId", json(Effect.gen(function* () {
		const s = yield* scope, value = yield* body(yield* request), input = yield* parse(() => copyInput.parse(value));
		return yield* s.service.resizeReservation(s.workspace, input.viewId, s.reservationId!, input.bytes);
	}))),
	HttpRouter.del("/workspace/:workspace/reservations/:reservationId", json(Effect.gen(function* () { const s = yield* scope; return yield* s.service.releaseReservation(s.workspace, s.reservationId!); }))),
);
