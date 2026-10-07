import { Context, Effect, Layer, type Scope } from "effect";
import {
	AndroidSessions,
	type AndroidSessionsService,
} from "../../android/session/session";
import { androidSerialFromStateId } from "../../android/device/identifiers";
import { IosSessions, type IosSessionsService } from "../../ios/session";
import {
	WorkspaceError,
	WORKSPACE_LIMITS,
	type BridgeByteReservation,
	type WorkspaceInputResult,
	type WorkspaceScreenConfig,
	type WorkspaceVideoDelivery,
	type WorkspaceVideoRead,
} from "./contracts";
import {
	makeWorkspaceSessions,
	type WorkspaceDevice,
	type WorkspaceLeaseInfo,
	type WorkspaceSessionsOptions,
} from "./sessions";

export type WorkspaceView = { workspace: string; viewId: string };
export type WorkspaceLease = WorkspaceView & WorkspaceLeaseInfo;
export type WorkspaceConfiguration = WorkspaceView & {
	leaseId: string;
	config: WorkspaceScreenConfig;
};
export type WorkspaceDelivery = WorkspaceView & WorkspaceVideoDelivery & {
	leaseId: string;
	device: string;
};
export type WorkspaceInputReply = WorkspaceView & WorkspaceInputResult & {
	leaseId: string;
	device: string;
};

const failure = (error: unknown): WorkspaceError =>
	error instanceof WorkspaceError
		? error
		: new WorkspaceError(
				"unavailable",
				error instanceof Error
					? error.message.slice(0, 4096)
					: "The workspace operation is unavailable.",
			);

/** Interruption aborts the operation, then awaits its owned native cleanup. */
function awaited<A>(
	start: (signal: AbortSignal) => Promise<A>,
	cancel?: (value: A) => Promise<void> | void,
): Effect.Effect<A, WorkspaceError> {
	return Effect.uninterruptibleMask((restore) =>
		Effect.flatMap(Effect.sync(() => {
			const controller = new AbortController();
			const promise = Promise.resolve().then(() => start(controller.signal));
			return { controller, promise };
		}), ({ controller, promise }) =>
			restore(Effect.tryPromise({ try: () => promise, catch: failure })).pipe(
				Effect.onInterrupt(() => Effect.promise(async () => {
					controller.abort();
					try { await cancel?.(await promise); } catch { /* Failed acquisition owns its cleanup. */ }
				})),
			),
		),
	);
}

/** Borrow current sessions. This resolver does not boot or stop a device. */
export function workspaceDeviceResolver(
	android: Pick<AndroidSessionsService, "get">,
	ios: Pick<IosSessionsService, "get">,
): WorkspaceSessionsOptions["resolve"] {
	return async (device) => {
		const serial = androidSerialFromStateId(device);
		if (serial !== null) {
			if (!serial || serial.length > 248 || [...serial].some((value) => value.codePointAt(0)! <= 32 || value.codePointAt(0) === 127))
				throw new WorkspaceError("invalid", "Select a connected Android device ID.");
			const session = await Effect.runPromise(android.get(serial));
			return {
				platform: "android",
				readConfig: async () => {
					const config = await session.readConfig();
					return { width: config.width, height: config.height, orientation: config.orientation, presentationGeneration: config.presentationGeneration };
				},
				subscribeAvcc: (sink) => session.attachAvccSink(sink),
				requestKeyframe: () => session.requestVideoKeyframe(),
				reserveInput: (owner) => session.reserveInput(owner),
				releaseInput: (owner) => session.releaseInput(owner),
				dispatchInputFrame: (frame, owner) => session.dispatchInputFrame(frame, owner),
			} satisfies WorkspaceDevice;
		}
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(device))
			throw new WorkspaceError("invalid", "Select an iOS simulator UDID or connected Android device ID.");
		const session = await Effect.runPromise(ios.get(device));
		await session.start();
		return {
			platform: "ios",
			readConfig: async () => {
				let config = session.screenConfig();
				if (config.width <= 0 || config.height <= 0) {
					// Wait for an existing capture frame; do not start another capture.
					await session.captureScreenshot();
					config = session.screenConfig();
				}
				return config;
			},
			subscribeAvcc: (sink) => session.subscribeAvcc(sink),
			subscribeJpeg: (sink) => session.subscribeMjpeg({ write: (bytes) => sink(bytes) }),
			requestKeyframe: () => session.requestVideoKeyframe(),
			reserveInput: (owner) => session.reserveInput(owner),
			releaseInput: (owner) => session.releaseInput(owner),
			dispatchInputFrame: (frame, owner) => session.dispatchInputFrame(frame, owner),
		} satisfies WorkspaceDevice;
	};
}

export function makeWorkspaceService(options: WorkspaceSessionsOptions) {
	return Effect.gen(function* () {
		const reservations = new Map<string, Map<string, { viewId: string; release: BridgeByteReservation }>>();
		const sessions = yield* Effect.acquireRelease(
			Effect.sync(() => makeWorkspaceSessions({ ...options, onGroupClosed: (workspace) => {
				for (const item of reservations.get(workspace)?.values() ?? []) item.release();
				reservations.delete(workspace);
				options.onGroupClosed?.(workspace);
			} })),
			(value) => Effect.promise(() => value.dispose()),
		);
		const view = (workspace: string, viewId: string) => {
			if (!sessions.hasConnection(viewId, workspace))
				throw new WorkspaceError("closed", "This workspace view is closed or belongs to another workspace.");
		};
		const checked = <A>(run: () => A) => Effect.try({ try: run, catch: failure });
		return {
			createWorkspace: () => checked(() => {
				const workspace = crypto.randomUUID();
				sessions.createGroup(workspace);
				return { workspace };
			}),
			renewWorkspace: (workspace: string) => checked(() => {
				if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspace))
					throw new WorkspaceError("invalid", "Use a valid workspace ID.");
				sessions.createGroup(workspace);
				return { workspace };
			}),
			openView: (workspace: string) => checked(() => {
				if (!sessions.hasGroup(workspace)) throw new WorkspaceError("closed", "This workspace is closed.");
				const viewId = crypto.randomUUID();
				sessions.connect(viewId, workspace);
				return { workspace, viewId };
			}),
			open: (workspace: string, viewId: string, device: string, codec: "avcc" | "jpeg" = "avcc") =>
				Effect.flatMap(checked(() => view(workspace, viewId)), () =>
					awaited(async (signal) => {
						if (signal.aborted) throw new WorkspaceError("closed", "The device lease was cancelled.");
						return { workspace, viewId, ...await sessions.open(viewId, device, codec) };
					}, (lease) => sessions.close(viewId, lease.leaseId)),
				),
			config: (workspace: string, viewId: string, leaseId: string) =>
				Effect.flatMap(checked(() => view(workspace, viewId)), () => awaited(async () => ({
					workspace, viewId, leaseId, config: await sessions.config(viewId, leaseId),
				}))),
			read: (workspace: string, viewId: string, leaseId: string, request: WorkspaceVideoRead = {}): Effect.Effect<WorkspaceDelivery, WorkspaceError, Scope.Scope> =>
				Effect.uninterruptibleMask((restore) => Effect.gen(function* () {
					yield* checked(() => view(workspace, viewId));
					const delivery = yield* restore(awaited(
						(signal) => sessions.read(viewId, leaseId, {
							...request,
							signal: request.signal ? AbortSignal.any([request.signal, signal]) : signal,
						}),
						(value) => value.release(),
					));
					yield* Effect.addFinalizer(() => Effect.sync(() => delivery.release()));
					return {
						workspace, viewId, leaseId, device: delivery.device,
						get bytes() { return delivery.bytes; },
						cursor: delivery.cursor, epoch: delivery.epoch, reset: delivery.reset,
						mimeType: delivery.mimeType, release: () => delivery.release(),
					};
				})),
			input: (workspace: string, viewId: string, batch: unknown) =>
				Effect.flatMap(checked(() => view(workspace, viewId)), () => awaited(async (signal) => {
					const result = await sessions.input(viewId, batch, signal);
					const value = batch as { leaseId: string; device: string };
					return { workspace, viewId, leaseId: value.leaseId, device: value.device, ...result };
				})),
			close: (workspace: string, viewId: string, leaseId: string) =>
				Effect.flatMap(checked(() => view(workspace, viewId)), () => awaited(async () => {
					await sessions.close(viewId, leaseId);
					return { workspace, viewId, leaseId, closed: true as const };
				})).pipe(Effect.uninterruptible),
			closeView: (workspace: string, viewId: string) =>
				awaited(async () => {
					await sessions.closeConnection(viewId, workspace);
					return { workspace, viewId, closed: true as const };
				}).pipe(Effect.uninterruptible),
			closeWorkspace: (workspace: string) => awaited(async () => {
				await sessions.closeGroup(workspace);
				return { workspace, closed: true as const };
			}).pipe(Effect.uninterruptible),
			reserveBytes: (workspace: string, viewId: string, bytes: number) =>
				Effect.acquireRelease(
					checked(() => { view(workspace, viewId); return sessions.reserveBytes(viewId, bytes); }),
					(release) => Effect.sync(release),
				),
			retainBytes: (workspace: string, viewId: string, bytes: number) => checked(() => {
				view(workspace, viewId);
				if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > WORKSPACE_LIMITS.connectionBytes) throw new WorkspaceError("bounds", "Use a valid workspace response byte count.");
				const entries = reservations.get(workspace) ?? new Map();
				if (entries.size >= 32) throw new WorkspaceError("bounds", "The workspace has too many retained transport responses.");
				const release = sessions.retainBytes(viewId, bytes + 256);
				const reservationId = crypto.randomUUID();
				entries.set(reservationId, { viewId, release }); reservations.set(workspace, entries);
				return { reservationId };
			}),
			resizeReservation: (workspace: string, viewId: string, reservationId: string, bytes: number) => checked(() => {
				if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > WORKSPACE_LIMITS.connectionBytes) throw new WorkspaceError("bounds", "Use a valid workspace response byte count.");
				const item = reservations.get(workspace)?.get(reservationId);
				if (!item || item.viewId !== viewId) throw new WorkspaceError("closed", "This workspace byte reservation is closed or belongs to another view.");
				item.release.resize(bytes + 256);
				return { reservationId };
			}),
			releaseReservation: (workspace: string, reservationId: string) => checked(() => {
				const entries = reservations.get(workspace), item = entries?.get(reservationId);
				item?.release(); entries?.delete(reservationId);
				if (entries?.size === 0) reservations.delete(workspace);
				return { released: true as const };
			}),
		};
	});
}

export type WorkspaceSessionsService = Effect.Effect.Success<ReturnType<typeof makeWorkspaceService>>;
export class WorkspaceSessions extends Context.Tag("@agentsims/WorkspaceSessions")<
	WorkspaceSessions, WorkspaceSessionsService
>() {}

export const workspaceSessionsLayer = (options: WorkspaceSessionsOptions) =>
	Layer.scoped(WorkspaceSessions, makeWorkspaceService(options));

export const WorkspaceSessionsLive = Layer.scoped(
	WorkspaceSessions,
	Effect.gen(function* () {
		const android = yield* AndroidSessions;
		const ios = yield* IosSessions;
		return yield* makeWorkspaceService({ resolve: workspaceDeviceResolver(android, ios) });
	}),
);
