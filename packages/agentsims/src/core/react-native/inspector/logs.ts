import { Effect, Queue, Stream } from "effect";
import { ForegroundApps } from "../../tools/devices/foreground-apps";
import type {
	LogRecordInput,
	LogSourceStatus,
	LogTarget,
} from "../../tools/logs/contracts";
import type { RnProjectContext } from "../source-context";
import { inspectorJson, symbolicateRnLog, type RnInspectorFetch } from "./http";
import {
	metroOrigin,
	selectInspectorTarget,
	RN_LOG_LIMITS,
	type InspectorTarget,
} from "./protocol";
import {
	openInspectorSession,
	type InspectorEnd,
	type InspectorSocketFactory,
} from "./session";

export type ReactNativeLogSourceEvent =
	| { readonly type: "record"; readonly record: LogRecordInput }
	| { readonly type: "status"; readonly status: LogSourceStatus }
	| {
			readonly type: "gap";
			readonly device: string;
			readonly reason: "reconnect" | "retention";
	  };

export type ReactNativeLogOptions = {
	readonly platform: "ios" | "android";
	readonly pollMs?: number;
	readonly retryMs?: number;
	readonly timeoutMs?: number;
	readonly symbolicationMs?: number;
	readonly symbolicate?: boolean;
	readonly now?: () => number;
	readonly fetch?: RnInspectorFetch;
	readonly socket?: InspectorSocketFactory;
};

type Application = { readonly app: string; readonly pid?: number };

/** The selected project, native application, Metro origin, and inspector target are explicit. */
export function reactNativeApplicationLogStream(
	target: LogTarget,
	project: RnProjectContext | null,
	options: ReactNativeLogOptions,
) {
	return Stream.unwrapScoped(
		Effect.gen(function* () {
			const status = (
				state: LogSourceStatus["state"],
				reason?: string,
				application?: Application,
			): LogSourceStatus =>
				Object.freeze({
					device: target.device,
					source: "react-native",
					state,
					reason,
					app:
						application?.app ??
						(target.app.mode === "fixed" ? target.app.id : undefined),
					projectId: target.reactNative?.projectId,
					targetId: target.reactNative?.targetId,
				});
			const unavailable = (reason: string) =>
				Stream.succeed<ReactNativeLogSourceEvent>({
					type: "status",
					status: status("unavailable", reason),
				});
			const rn = target.reactNative;
			if (!rn || !project)
				return unavailable(
					"Select a React Native project, Metro URL, and inspector target",
				);
			if (target.app.mode === "fixed" && target.app.pid !== undefined)
				return unavailable(
					"The inspector does not expose a native PID; select an application and inspector target",
				);
			if (
				rn.projectId !== project.projectKey ||
				(target.projectId !== undefined &&
					target.projectId !== project.projectKey)
			)
				return unavailable(
					"The inspector project does not match the selected source project",
				);
			if (
				!rn.targetId ||
				rn.targetId.length > 512 ||
				(options.platform !== "ios" && options.platform !== "android")
			)
				return unavailable("Invalid inspector target or device platform");
			let metro: URL;
			try {
				metro = metroOrigin(rn.metroUrl);
			} catch {
				return unavailable("Select a local Metro HTTP origin");
			}
			for (const interval of [
				options.pollMs ?? 1_000,
				options.retryMs ?? 2_000,
				options.timeoutMs ?? 5_000,
				options.symbolicationMs ?? 2_000,
			])
				if (!Number.isInteger(interval) || interval < 1 || interval > 30_000)
					return unavailable(
						"Inspector intervals must be from 1 to 30000 milliseconds",
					);
			const foreground = yield* ForegroundApps;
			const fetcher: RnInspectorFetch =
				options.fetch ?? ((url, init) => fetch(url, init));
			// lib.dom hides Bun's documented client-header constructor overload.
			const BunWebSocket = globalThis.WebSocket as unknown as new (
				url: string,
				options: Bun.WebSocketOptions,
			) => WebSocket;
			const factory: InspectorSocketFactory =
				options.socket ??
				((url, origin) =>
					new BunWebSocket(url, { headers: { Origin: origin } }));
			const queue = yield* Queue.bounded<ReactNativeLogSourceEvent>(64);
			yield* Effect.addFinalizer(() => Queue.shutdown(queue));
			const emit = (event: ReactNativeLogSourceEvent) =>
				Queue.offer(queue, event).pipe(Effect.asVoid);
			const select = Effect.gen(function* () {
				const current =
					target.app.mode === "foreground"
						? yield* foreground.read(target.device)
						: null;
				const app =
					target.app.mode === "fixed" ? target.app.id : current?.bundleId;
				if (!app || app.length > 512) return null;
				return Object.freeze({
					app,
					pid:
						current?.bundleId === app ? (current.pid ?? undefined) : undefined,
				});
			}).pipe(Effect.orElseSucceed(() => null));
			const capture = (inspector: InspectorTarget, application: Application) =>
				Effect.scoped(
					Effect.gen(function* () {
						const session = yield* Effect.acquireRelease(
							Effect.try(() =>
								openInspectorSession(inspector.socketUrl, metro.origin, {
									factory,
									context: {
										device: target.device,
										platform: options.platform,
										app: application.app,
										projectId: project.projectKey,
									},
									now: options.now ?? Date.now,
									timeoutMs: options.timeoutMs ?? 5_000,
								}),
							),
							(session) => Effect.sync(() => session.dispose()),
						);
						const process = Effect.gen(function* () {
							const failed = yield* Effect.tryPromise(() => session.ready);
							if (failed) return failed;
							yield* emit({
								type: "status",
								status: status("live", undefined, application),
							});
							while (true) {
								const entry = yield* Effect.tryPromise((signal) =>
									session.next(signal),
								);
								if (!("record" in entry)) return entry;
								const log =
									options.symbolicate === false
										? entry
										: yield* Effect.tryPromise((signal) =>
												symbolicateRnLog(
													entry,
													project,
													metro,
													fetcher,
													signal,
													options.symbolicationMs ?? 2_000,
												),
											);
								yield* emit({ type: "record", record: log.record });
							}
						});
						const watch = Effect.gen(function* () {
							while (true) {
								yield* Effect.sleep(options.pollMs ?? 1_000);
								const next = yield* select;
								if (
									!next ||
									next.app !== application.app ||
									next.pid !== application.pid
								)
									return {
										state: "reconnecting",
										reason: "The selected application changed",
										gap: "reconnect",
									} satisfies InspectorEnd;
							}
						});
						return yield* Effect.raceFirst(process, watch);
					}),
				);
			let attempt = 0;
			let attached = false;
			let lastStatus = "";
			const update = (value: LogSourceStatus) => {
				const key = JSON.stringify(value);
				if (key === lastStatus) return Effect.void;
				lastStatus = key;
				return emit({ type: "status", status: value });
			};
			yield* Effect.gen(function* () {
				while (true) {
					const application = yield* select;
					if (!application) {
						yield* update(
							status("waiting", "Waiting for the selected native application"),
						);
						yield* Effect.sleep(options.pollMs ?? 1_000);
						continue;
					}
					yield* update(
						status(
							attached ? "reconnecting" : "connecting",
							undefined,
							application,
						),
					);
					const selection = yield* Effect.tryPromise(async (signal) =>
						selectInspectorTarget(
							await inspectorJson(fetcher, new URL("/json/list", metro), {
								signal,
								timeoutMs: options.timeoutMs ?? 5_000,
								bytes: RN_LOG_LIMITS.discoveryBytes,
							}),
							metro,
							rn.targetId,
							application.app,
						),
					).pipe(
						Effect.orElseSucceed(() => ({
							state: "unavailable" as const,
							reason: "Cannot read the local Metro inspector targets",
						})),
					);
					if ("target" in selection) {
						const end = yield* capture(selection.target, application).pipe(
							Effect.orElseSucceed(() => ({
								state: "unavailable" as const,
								reason: "Cannot read inspector Runtime events",
								gap: "reconnect" as const,
							})),
						);
						attached = true;
						yield* emit({
							type: "gap",
							device: target.device,
							reason: end.gap,
						});
						yield* update(status(end.state, end.reason, application));
						// A proxy which replaced this session must not be challenged with another attach.
						if (end.state === "debugger-conflict") return;
					} else {
						yield* update(
							status(selection.state, selection.reason, application),
						);
						if (selection.state === "debugger-conflict") return;
					}
					const delay = Math.min(
						30_000,
						(options.retryMs ?? 2_000) * 2 ** Math.min(attempt++, 4),
					);
					yield* Effect.sleep(delay);
				}
			}).pipe(Effect.forkScoped);
			return Stream.fromQueue(queue);
		}),
	);
}
