import { expect, test } from "bun:test";
import { Effect, Fiber, ManagedRuntime } from "effect";
import type { AvccSink } from "../../../../../core/stream/avcc-wire";
import { avccEnvelope } from "../../../../../core/stream/avcc-wire";
import type { WorkspaceDevice } from "../../../../../core/tools/workspace/sessions";
import {
	WorkspaceSessions,
	workspaceDeviceResolver,
	workspaceSessionsLayer,
} from "../../../../../core/tools/workspace/service";

function device(platform: "ios" | "android") {
	let detached = 0;
	let owner: string | undefined;
	const sinks = new Set<AvccSink>();
	const frames: Array<{ type: string; owner: string }> = [];
	let dispatch = async (_frame: Buffer) => {};
	let subscribe = async () => {};
	const native: WorkspaceDevice = {
		platform,
		readConfig: async () => ({ width: 400, height: 800, orientation: "portrait" }),
		subscribeAvcc: async (sink) => {
			await subscribe(); sinks.add(sink);
			return () => { detached++; sinks.delete(sink); };
		},
		requestKeyframe: async () => {},
		reserveInput: (id) => { if (owner && owner !== id) return false; owner = id; return true; },
		releaseInput: (id) => { if (owner === id) owner = undefined; },
		dispatchInputFrame: async (frame, id) => {
			if (owner !== id) throw new Error("Wrong device input owner");
			frames.push({ type: JSON.parse(frame.subarray(1).toString()).type, owner: id });
			await dispatch(frame);
		},
	};
	return {
		native, frames, detached: () => detached, owner: () => owner,
		dispatch: (value: typeof dispatch) => { dispatch = value; },
		subscribe: (value: typeof subscribe) => { subscribe = value; },
		emit: () => {
			for (const sink of sinks) {
				sink.write(avccEnvelope(1, new Uint8Array([1, 2, 3])));
				sink.write(avccEnvelope(2, new Uint8Array([7])));
			}
		},
	};
}

async function fixture(connectionBytes?: number) {
	const ios = device("ios"), android = device("android");
	const runtime = ManagedRuntime.make(workspaceSessionsLayer({
		connectionBytes,
		resolve: async (id) => id === "ios" ? ios.native : android.native,
	}));
	const service = await runtime.runPromise(WorkspaceSessions);
	const { workspace } = await runtime.runPromise(service.createWorkspace());
	const view = await runtime.runPromise(service.openView(workspace));
	return { ios, android, runtime, service, workspace, viewId: view.viewId };
}

test("Effect scope closes borrowed subscriptions on both devices without closing sibling views", async () => {
	const f = await fixture();
	try {
		const other = await f.runtime.runPromise(f.service.openView(f.workspace));
		const ios = await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "ios"));
		await f.runtime.runPromise(f.service.open(f.workspace, other.viewId, "android"));
		const stolen = await f.runtime.runPromise(Effect.either(f.service.config(f.workspace, other.viewId, ios.leaseId)));
		expect(stolen._tag).toBe("Left");
		await f.runtime.runPromise(f.service.closeView(f.workspace, f.viewId));
		expect(f.ios.detached()).toBe(1); expect(f.android.detached()).toBe(0);
		const remaining = await f.runtime.runPromise(f.service.open(f.workspace, other.viewId, "android"));
		expect(remaining.config.platform).toBe("android");
	} finally { await f.runtime.dispose(); }
	expect(f.android.detached()).toBe(2);
});

test("runtime finalization awaits native input and releases the original device before detaching", async () => {
	const f = await fixture(), started = Promise.withResolvers<void>(), nativeReply = Promise.withResolvers<void>();
	let first = true;
	f.ios.dispatch(async () => { if (first) { first = false; started.resolve(); await nativeReply.promise; } });
	const lease = await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "ios"));
	const input = f.runtime.runPromise(f.service.input(f.workspace, f.viewId, {
		leaseId: lease.leaseId, device: "ios", configRevision: lease.config.revision,
		batchId: "held", sequence: 1, events: [{ kind: "touch", phase: "begin", x: 0.2, y: 0.3 }],
	}));
	await started.promise;
	let disposed = false;
	const closing = f.runtime.dispose().then(() => { disposed = true; });
	await Promise.resolve(); expect(disposed).toBe(false); expect(f.ios.owner()).toBe(lease.leaseId);
	nativeReply.resolve(); await closing; await input;
	expect(f.ios.frames.map((value) => value.type)).toEqual(["begin", "end"]);
	expect(f.ios.owner()).toBeUndefined(); expect(f.ios.detached()).toBe(1);
	expect(f.android.frames).toHaveLength(0);
});

test("interrupted late attachment awaits and detaches only its acquired subscription", async () => {
	const f = await fixture(), entered = Promise.withResolvers<void>(), attach = Promise.withResolvers<void>();
	f.ios.subscribe(async () => { entered.resolve(); await attach.promise; });
	try {
		const fiber = f.runtime.runFork(f.service.open(f.workspace, f.viewId, "ios"));
		await entered.promise;
		let finished = false;
		const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then(() => { finished = true; });
		await Promise.resolve(); expect(finished).toBe(false);
		attach.resolve(); await interrupted;
		expect(f.ios.detached()).toBe(1);
		const live = await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "android"));
		expect(live.device).toBe("android");
	} finally { attach.resolve(); await f.runtime.dispose(); }
});

test("interrupted input waits for native work, releases held keys and cannot replay an unknown result", async () => {
	const f = await fixture(), entered = Promise.withResolvers<void>(), reply = Promise.withResolvers<void>();
	let first = true;
	f.ios.dispatch(async () => { if (first) { first = false; entered.resolve(); await reply.promise; } });
	try {
		const lease = await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "ios"));
		const batch = { leaseId: lease.leaseId, device: "ios", configRevision: 1, batchId: "key", sequence: 1, events: [{ kind: "key", phase: "down", usage: 4 }] };
		const fiber = f.runtime.runFork(f.service.input(f.workspace, f.viewId, batch));
		await entered.promise;
		let finished = false;
		const interrupted = Effect.runPromise(Fiber.interrupt(fiber)).then(() => { finished = true; });
		await Promise.resolve(); expect(finished).toBe(false); reply.resolve(); await interrupted;
		expect(f.ios.frames.map((value) => value.type)).toEqual(["down", "up"]);
		const repeated = await f.runtime.runPromise(f.service.input(f.workspace, f.viewId, batch));
		expect(repeated.dispatch).toBe("unknown"); expect(f.ios.frames).toHaveLength(2);
		expect(f.ios.owner()).toBeUndefined();
	} finally { reply.resolve(); await f.runtime.dispose(); }
});

test("scoped video cancellation permits the next read and scoped delivery release invalidates bytes", async () => {
	const f = await fixture();
	try {
		const lease = await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "ios"));
		const fiber = f.runtime.runFork(Effect.scoped(f.service.read(f.workspace, f.viewId, lease.leaseId)));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await Effect.runPromise(Fiber.interrupt(fiber));
		const reading = f.runtime.runPromise(Effect.scoped(Effect.gen(function* () {
			const delivery = yield* f.service.read(f.workspace, f.viewId, lease.leaseId);
			expect(delivery).toMatchObject({ workspace: f.workspace, viewId: f.viewId, leaseId: lease.leaseId, device: "ios", reset: true });
			expect(delivery.bytes.length).toBeGreaterThan(0);
			return delivery;
		})));
		f.ios.emit();
		const delivery = await reading; expect(delivery.bytes).toHaveLength(0);
	} finally { await f.runtime.dispose(); }
});

test("adapter reservations share one budget across views and release at the caller scope", async () => {
	const f = await fixture(1000);
	try {
		const other = await f.runtime.runPromise(f.service.openView(f.workspace));
		await f.runtime.runPromise(Effect.scoped(Effect.gen(function* () {
			yield* f.service.reserveBytes(f.workspace, f.viewId, 600);
			const result = yield* Effect.either(f.service.reserveBytes(f.workspace, other.viewId, 600));
			expect(result._tag).toBe("Left");
		})));
		await f.runtime.runPromise(Effect.scoped(f.service.reserveBytes(f.workspace, other.viewId, 600)));
		const missing = await f.runtime.runPromise(Effect.either(f.service.openView("another-workspace")));
		expect(missing._tag).toBe("Left");
	} finally { await f.runtime.dispose(); }
});

test("platform resolver preserves canonical IDs and waits only for the existing first iOS frame", async () => {
	const calls: string[] = [];
	let width = 0;
	const ios = {
		start: async () => { calls.push("ios-start"); },
		screenConfig: () => ({ width, height: 800, orientation: "portrait" }),
		captureScreenshot: async () => { calls.push("existing-frame"); width = 400; },
	};
	const android = { readConfig: async () => ({ width: 400, height: 800, orientation: "portrait", presentationGeneration: 3, cornerRadii: [1, 2] }) };
	const resolve = workspaceDeviceResolver(
		{ get: (serial: string) => { calls.push(serial); return Effect.succeed(android); } } as Parameters<typeof workspaceDeviceResolver>[0],
		{ get: (udid: string) => { calls.push(udid); return Effect.succeed(ios); } } as Parameters<typeof workspaceDeviceResolver>[1],
	);
	const udid = "DE7F57A7-6630-4DF1-9B64-576CB9FFAF18";
	const first = await resolve(udid);
	expect(await first.readConfig()).toEqual({ width: 400, height: 800, orientation: "portrait" });
	await first.readConfig();
	const second = await resolve("android:emulator-5554");
	expect(await second.readConfig()).toEqual({ width: 400, height: 800, orientation: "portrait", presentationGeneration: 3 });
	expect(calls).toEqual([udid, "ios-start", "existing-frame", "emulator-5554"]);
	await expect(resolve("android-avd:unstarted")).rejects.toMatchObject({ code: "invalid" });
	await expect(resolve("android:")).rejects.toMatchObject({ code: "invalid" });
});

test("idle workspace renewal preserves context identity and invalidates old views", async () => {
	const timers = new Set<() => void>(), ios = device("ios");
	const runtime = ManagedRuntime.make(workspaceSessionsLayer({
		resolve: async () => ios.native,
		schedule: (run) => { timers.add(run); return () => { timers.delete(run); }; },
	}));
	try {
		const service = await runtime.runPromise(WorkspaceSessions);
		const { workspace } = await runtime.runPromise(service.createWorkspace());
		const view = await runtime.runPromise(service.openView(workspace));
		await runtime.runPromise(service.open(workspace, view.viewId, "ios"));
		for (const expire of Array.from(timers)) expire();
		await runtime.runPromise(service.closeWorkspace(workspace));
		expect(ios.detached()).toBe(1);
		expect(await runtime.runPromise(service.renewWorkspace(workspace))).toEqual({ workspace });
		const next = await runtime.runPromise(service.openView(workspace));
		expect(next.workspace).toBe(workspace); expect(next.viewId).not.toBe(view.viewId);
		const stale = await runtime.runPromise(Effect.either(service.open(workspace, view.viewId, "ios")));
		expect(stale._tag).toBe("Left");
		await runtime.runPromise(service.open(workspace, next.viewId, "ios"));
	} finally { await runtime.dispose(); }
	expect(ios.detached()).toBe(2);
});

test("concurrent view close is idempotent and a foreign group cannot close it", async () => {
	const f = await fixture();
	try {
		const foreign = await f.runtime.runPromise(f.service.createWorkspace());
		await f.runtime.runPromise(f.service.open(f.workspace, f.viewId, "ios"));
		const rejected = await f.runtime.runPromise(Effect.either(f.service.closeView(foreign.workspace, f.viewId)));
		expect(rejected._tag).toBe("Left"); expect(f.ios.detached()).toBe(0);
		const [first, second] = await Promise.all([
			f.runtime.runPromise(f.service.closeView(f.workspace, f.viewId)),
			f.runtime.runPromise(f.service.closeView(f.workspace, f.viewId)),
		]);
		expect(first.closed).toBe(true); expect(second.closed).toBe(true); expect(f.ios.detached()).toBe(1);
		expect((await f.runtime.runPromise(f.service.closeView(f.workspace, f.viewId))).closed).toBe(true);
	} finally { await f.runtime.dispose(); }
});
