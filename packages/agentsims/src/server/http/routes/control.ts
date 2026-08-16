import {
	HttpRouter,
	HttpServerRequest,
	HttpServerResponse,
	Socket,
} from "@effect/platform";
import { Cause, Effect, Exit, Fiber } from "effect";
import type { Scope } from "effect/Scope";
import {
	UI_OPTIONS,
	getUiStatus,
	normalizeUiValue,
	setUiOption,
} from "../../../ios/device/ui-settings";
import { HttpRuntime } from "../../../services/http-runtime";
import { ShellExec, type ShellExecService } from "../../../services/runtime";
import { json, requestSource, requestedDevice } from "./shared";

function execSocket(
	request: HttpServerRequest.HttpServerRequest,
	runtime: typeof HttpRuntime.Service,
	shell: ShellExecService,
): Effect.Effect<HttpServerResponse.HttpServerResponse, unknown, Scope> {
	return Effect.gen(function* () {
		const source = requestSource(request.source);
		const origin = source.headers.get("origin");
		if (origin && new URL(origin).host !== source.headers.get("host")) {
			return HttpServerResponse.text("Cross-origin request blocked", {
				status: 403,
			});
		}
		const socket = yield* request.upgrade;
		const write = yield* socket.writer;
		const subscriptions = new Map<number, AbortController>();
		let authenticated = false;
		const send = (value: unknown) =>
			write(JSON.stringify(value)).pipe(Effect.catchAll(() => Effect.void));
		const authTimeout = yield* Effect.sleep("10 seconds").pipe(
			Effect.zipRight(
				write(new Socket.CloseEvent(1008, "Authentication timeout")),
			),
			Effect.catchAll(() => Effect.void),
			Effect.forkScoped,
		);
		yield* socket
			.runRaw((raw) =>
				Effect.gen(function* () {
					if (
						(typeof raw === "string"
							? Buffer.byteLength(raw)
							: raw.byteLength) >
						4 * 1024 * 1024
					) {
						return yield* write(new Socket.CloseEvent(1009));
					}
					let value: unknown;
					try {
						value = JSON.parse(
							typeof raw === "string" ? raw : new TextDecoder().decode(raw),
						);
					} catch {
						return;
					}
					if (!value || typeof value !== "object") return;
					if (!authenticated) {
						if ("token" in value && value.token === runtime.execToken) {
							authenticated = true;
							yield* Fiber.interrupt(authTimeout);
							yield* send({ ready: true });
						} else yield* write(new Socket.CloseEvent(1008));
						return;
					}
					if ("unsub" in value && typeof value.unsub === "number") {
						subscriptions.get(value.unsub)?.abort();
						subscriptions.delete(value.unsub);
						return;
					}
					if (
						"sub" in value &&
						typeof value.sub === "number" &&
						"path" in value &&
						typeof value.path === "string"
					) {
						const sub = value.sub;
						const path = value.path;
						const allowed = [
							`${runtime.basePath}/api/events`,
							`${runtime.basePath}/appstate`,
							`${runtime.basePath}/ax`,
						];
						if (!allowed.includes(path.split("?", 1)[0]!)) {
							yield* send({ sub, end: true, error: "path not allowed" });
							return;
						}
						const controller = new AbortController();
						subscriptions.set(sub, controller);
						yield* Effect.promise(async () => {
							try {
								const response = await fetch(new URL(path, source.url), {
									signal: controller.signal,
								});
								const reader = response.body?.getReader();
								if (!reader) return;
								const decoder = new TextDecoder();
								while (true) {
									const chunk = await reader.read();
									if (chunk.done) break;
									Effect.runFork(
										send({
											sub,
											data: decoder.decode(chunk.value, { stream: true }),
										}),
									);
								}
							} catch (error) {
								if (
									!(
										error instanceof DOMException && error.name === "AbortError"
									)
								) {
									console.warn("[agentsims:server] SSE relay failed", error);
								}
							}
							subscriptions.delete(sub);
							Effect.runFork(send({ sub, end: true }));
						}).pipe(Effect.forkScoped);
						return;
					}
					if ("id" in value && typeof value.id === "number" && "ui" in value) {
						const id = value.id;
						const ui = value.ui;
						if (
							!ui ||
							typeof ui !== "object" ||
							!("device" in ui) ||
							typeof ui.device !== "string" ||
							!/^[0-9A-Za-z-]+$/.test(ui.device)
						) {
							yield* send({ id, error: "missing or invalid device udid" });
							return;
						}
						const device = ui.device;
						if (!("option" in ui) || ui.option === undefined) {
							yield* send({
								id,
								status: yield* Effect.promise(() => getUiStatus(device)),
							});
							return;
						}
						if (typeof ui.option !== "string" || !UI_OPTIONS[ui.option]) {
							yield* send({
								id,
								error: `unknown option: ${String(ui.option)}`,
							});
							return;
						}
						const option = ui.option;
						const normalized =
							"value" in ui && typeof ui.value === "string"
								? normalizeUiValue(option, ui.value)
								: null;
						if (normalized === null) {
							yield* send({ id, error: `invalid value for ${option}` });
							return;
						}
						yield* Effect.promise(() =>
							setUiOption(device, option, normalized),
						);
						yield* send({ id, ok: true });
						return;
					}
					if (
						"id" in value &&
						typeof value.id === "number" &&
						"command" in value &&
						typeof value.command === "string"
					) {
						yield* send({ id: value.id, ...(yield* shell.run(value.command)) });
					}
				}),
			)
			.pipe(
				Effect.ensuring(
					Effect.sync(() => {
						for (const controller of subscriptions.values()) controller.abort();
					}),
				),
				Effect.catchAll(() => Effect.void),
			);
		return HttpServerResponse.empty();
	});
}

const screenshotFibers = new Map<string, Fiber.RuntimeFiber<string, unknown>>();

export const controlRoutes = HttpRouter.empty.pipe(
	HttpRouter.post(
		"/exec",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const shell = yield* ShellExec;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			if (!request.headers.get("content-type")?.startsWith("application/json"))
				return HttpServerResponse.raw(
					json(
						{ stdout: "", stderr: "Unsupported Media Type", exitCode: 1 },
						415,
					),
				);
			const origin = request.headers.get("origin");
			if (origin && new URL(origin).host !== request.headers.get("host"))
				return HttpServerResponse.raw(
					json(
						{ stdout: "", stderr: "Cross-origin request blocked", exitCode: 1 },
						403,
					),
				);
			if (
				request.headers.get("authorization") !== `Bearer ${runtime.execToken}`
			)
				return HttpServerResponse.raw(
					json({ stdout: "", stderr: "Unauthorized", exitCode: 1 }, 401),
				);
			const value: unknown = yield* Effect.promise(() => request.json());
			const command =
				value &&
				typeof value === "object" &&
				"command" in value &&
				typeof value.command === "string"
					? value.command
					: "";
			return HttpServerResponse.raw(
				command
					? json(yield* shell.run(command))
					: json({ stdout: "", stderr: "Missing command", exitCode: 1 }, 400),
			);
		}),
	),
	HttpRouter.get(
		"/exec-ws",
		Effect.gen(function* () {
			return yield* execSocket(
				yield* HttpServerRequest.HttpServerRequest,
				yield* HttpRuntime,
				yield* ShellExec,
			);
		}),
	),
	HttpRouter.post(
		"/screenshot/save",
		Effect.gen(function* () {
			const runtime = yield* HttpRuntime;
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			const saveId =
				url.searchParams.get("saveId") ?? url.searchParams.get("id") ?? "";
			if (!request.headers.get("content-type")?.startsWith("image/png")) {
				return HttpServerResponse.raw(
					json({ error: "Screenshot must be an image/png" }, 415),
				);
			}
			if (
				request.headers.get("authorization") !== `Bearer ${runtime.execToken}`
			) {
				return HttpServerResponse.raw(json({ error: "Unauthorized" }, 401));
			}
			const data = new Uint8Array(
				yield* Effect.promise(() => request.arrayBuffer()),
			);
			if (data.byteLength > 32 * 1024 * 1024) {
				return HttpServerResponse.raw(
					json({ error: "Screenshot is too large" }, 413),
				);
			}
			const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
			if (
				data.length < 8 ||
				!Buffer.from(data.subarray(0, 8)).equals(signature)
			) {
				return HttpServerResponse.raw(
					json({ error: "Screenshot is not a PNG" }, 400),
				);
			}
			const fiber = yield* Effect.fork(
				runtime.saveScreenshot(
					data,
					requestedDevice(url, runtime) ?? "unknown",
				),
			);
			if (saveId) screenshotFibers.set(saveId, fiber);
			const exit = yield* Fiber.await(fiber).pipe(
				Effect.ensuring(
					Effect.sync(() => {
						if (saveId) screenshotFibers.delete(saveId);
					}),
				),
			);
			if (Exit.isFailure(exit)) {
				const cancelled = Cause.isInterruptedOnly(exit.cause);
				return HttpServerResponse.raw(
					json(
						{
							error: cancelled
								? "Screenshot save cancelled"
								: String(Cause.squash(exit.cause)),
						},
						cancelled ? 409 : 500,
					),
				);
			}
			return HttpServerResponse.raw(json({ path: exit.value }, 201));
		}),
	),
	HttpRouter.del(
		"/screenshot/save",
		Effect.gen(function* () {
			const request = requestSource(
				(yield* HttpServerRequest.HttpServerRequest).source,
			);
			const url = new URL(request.url);
			const saveId =
				url.searchParams.get("saveId") ?? url.searchParams.get("id") ?? "";
			const fiber = screenshotFibers.get(saveId);
			if (fiber) yield* Fiber.interrupt(fiber);
			screenshotFibers.delete(saveId);
			return HttpServerResponse.raw(json({ ok: true }, 202));
		}),
	),
);
