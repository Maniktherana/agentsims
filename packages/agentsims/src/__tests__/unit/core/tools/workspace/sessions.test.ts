import { afterEach, expect, test } from "bun:test";
import { makeWorkspaceSessions, type WorkspaceDevice } from "../../../../../core/tools/workspace/sessions";
import { parseWorkspaceInput, createBridgeByteBudget, WORKSPACE_LIMITS } from "../../../../../core/tools/workspace/contracts";
import { avccEnvelope, type AvccSink } from "../../../../../core/stream/avcc-wire";
import { createVideoHandoff } from "../../../../../core/tools/workspace/video";
import type { BridgeByteBudget } from "../../../../../core/tools/workspace/contracts";

const services: Array<ReturnType<typeof makeWorkspaceSessions>> = [];
afterEach(async () => { await Promise.all(services.splice(0).map((service) => service.dispose())); });
function device(platform: "ios" | "android" = "ios") {
	let config = { width: 400, height: 800, orientation: "portrait" };
	let owner: string | undefined;
	let detached = 0;
	const frames: Array<{ tag: number; value: any; owner: string }> = [];
	const sinks = new Set<AvccSink>();
	let dispatch: (frame: Buffer) => Promise<void> = async () => {};
	const native: WorkspaceDevice = {
		platform, readConfig: async () => ({ ...config }),
		subscribeAvcc: async (sink) => { sinks.add(sink); return () => { sinks.delete(sink); detached += 1; }; },
		subscribeJpeg: async () => () => { detached += 1; }, requestKeyframe: async () => {},
		reserveInput: (id) => { if (owner && owner !== id) return false; owner = id; return true; },
		releaseInput: (id) => { if (owner === id) owner = undefined; },
		dispatchInputFrame: async (frame, id) => {
			if (id !== owner) throw new Error("Wrong input owner");
			frames.push({ tag: frame[0]!, value: JSON.parse(frame.subarray(1).toString()), owner: id });
			await dispatch(frame);
		},
	};
	return { native, frames, detached: () => detached, owner: () => owner, config: (next: typeof config) => { config = next; }, dispatch: (next: typeof dispatch) => { dispatch = next; }, emit: (bytes: Uint8Array) => { for (const sink of sinks) sink.write(bytes); } };
}
function batch(lease: { leaseId: string; device: string; config: { revision: number } }, sequence = 1, events: unknown[] = [{ kind: "touch", phase: "begin", x: 0.2, y: 0.7 }, { kind: "touch", phase: "end", x: 0.2, y: 0.7 }]) {
	return { leaseId: lease.leaseId, device: lease.device, configRevision: lease.config.revision, batchId: `batch-${sequence}`, sequence, events };
}
function service(devices: Record<string, ReturnType<typeof device>>, options: Partial<Parameters<typeof makeWorkspaceSessions>[0]> = {}) {
	const value = makeWorkspaceSessions({ resolve: async (id) => { if (!devices[id]) throw new Error("Missing device"); return devices[id]!.native; }, ...options }); services.push(value); return value;
}
function clock() {
	let now = 0, next = 0;
	const timers = new Map<number, { at: number; run: () => void }>();
	return {
		schedule: (run: () => void, milliseconds: number) => {
			const id = next++; timers.set(id, { at: now + milliseconds, run });
			return () => { timers.delete(id); };
		},
		advance: (milliseconds: number) => {
			now += milliseconds;
			for (const [id, timer] of timers) if (timer.at <= now && timers.delete(id)) timer.run();
		},
	};
}

test("views in one group share eight leases and one byte budget while another group stays independent", async () => {
	const ios = device(), app = service({ ios }, { connectionBytes: 4096 });
	app.createGroup("shared"); app.connect("a", "shared"); app.connect("b", "shared");
	const first = await app.open("a", "ios");
	for (let index = 0; index < 3; index++) await app.open("a", "ios");
	for (let index = 0; index < 4; index++) await app.open("b", "ios");
	await expect(app.open("b", "ios")).rejects.toThrow("eight");
	await expect(app.config("b", first.leaseId)).rejects.toThrow("another");
	const release = app.reserveBytes("a", 2500);
	expect(() => app.reserveBytes("b", 1000)).toThrow("limit");
	await app.open("separate", "ios");
	const independent = app.reserveBytes("separate", 3000);
	release(); independent();
	await app.closeConnection("a");
	expect(app.hasGroup("shared")).toBe(true);
	expect(app.hasConnection("b", "shared")).toBe(true);
	expect(ios.detached()).toBe(4);
	await app.open("b", "ios");
});

test("empty views consume the group view limit and an owner cannot move to another group", async () => {
	const app = service({}); app.createGroup("g"); app.createGroup("other");
	for (let index = 0; index < 8; index++) app.connect(`view-${index}`, "g");
	expect(() => app.connect("ninth", "g")).toThrow("eight views");
	expect(() => app.connect("view-0", "other")).toThrow("another group");
	expect(() => app.closeConnection("view-0", "other")).toThrow("another group");
	expect(app.hasConnection("view-0", "g")).toBe(true);
	expect(app.hasConnection("view-0", "other")).toBe(false);
	app.connect("view-0", "g");
	await app.closeConnection("view-0"); app.connect("ninth", "g");
	expect(app.hasConnection("ninth", "g")).toBe(true);
	expect(() => app.reserveBytes("view-0", 1)).toThrow("closed");
});

test("view idle expiry preserves an active sibling and its group", async () => {
	const time = clock(), ios = device(), android = device("android"), app = service({ ios, android }, { schedule: time.schedule });
	app.createGroup("g"); app.connect("a", "g"); app.connect("b", "g");
	await app.open("a", "ios"); const sibling = await app.open("b", "android");
	time.advance(WORKSPACE_LIMITS.idleMs - 1);
	await app.config("b", sibling.leaseId);
	time.advance(1);
	expect(app.hasConnection("a", "g")).toBe(false);
	expect(app.hasConnection("b", "g")).toBe(true);
	expect(app.hasGroup("g")).toBe(true);
	await app.closeConnection("a");
	expect(ios.detached()).toBe(1); expect(android.detached()).toBe(0);
	await app.config("b", sibling.leaseId);
	await app.closeGroup("g"); expect(android.detached()).toBe(1);
});

test("group expiry and concurrent disposal await cleanup already started for held input", async () => {
	const time = clock(), ios = device(), releaseStarted = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
	ios.dispatch(async (frame) => { if (JSON.parse(frame.subarray(1).toString()).type === "end") { releaseStarted.resolve(); await finish.promise; } });
	const app = service({ ios }, { schedule: time.schedule }); app.createGroup("g"); app.connect("a", "g");
	const lease = await app.open("a", "ios");
	await app.input("a", batch(lease, 1, [{ kind: "touch", phase: "begin", x: 0.2, y: 0.7 }]));
	time.advance(WORKSPACE_LIMITS.idleMs);
	expect(app.hasGroup("g")).toBe(false);
	expect(() => app.createGroup("g")).toThrow("closing");
	let done = false;
	const closing = app.closeGroup("g"), disposing = app.dispose().then(() => { done = true; });
	const viewClose = app.closeConnection("a", "g");
	expect(app.closeConnection("a", "g")).toBe(viewClose);
	expect(() => app.closeConnection("a", "other")).toThrow("another group");
	await releaseStarted.promise;
	expect(done).toBe(false); expect(ios.detached()).toBe(0);
	finish.resolve(); await Promise.all([closing, disposing, viewClose]);
	await app.closeConnection("absent", "other");
	expect(ios.detached()).toBe(1); expect(ios.owner()).toBeUndefined();
});

test("a config result arriving after disposal cannot allocate a new reservation", async () => {
	const ios = device(), pending = Promise.withResolvers<{ width: number; height: number; orientation: string }>(), started = Promise.withResolvers<void>();
	let budget: BridgeByteBudget | undefined;
	const app = service({ ios }, { createVideo: (options) => { budget = options.budget; return createVideoHandoff(options); } });
	const lease = await app.open("a", "ios");
	ios.native.readConfig = async () => { started.resolve(); return pending.promise; };
	const config = app.config("a", lease.leaseId).catch((error) => error);
	await started.promise; await app.dispose();
	expect(budget!.used).toBe(0);
	pending.resolve({ width: 800, height: 400, orientation: "landscape_left" });
	expect(await config).toMatchObject({ code: "closed" }); expect(budget!.used).toBe(0);
	expect(ios.detached()).toBe(1);
});

test("group close waits for a pending attachment and prevents late subscription or group recreation", async () => {
	const ios = device(), pending = Promise.withResolvers<{ width: number; height: number; orientation: string }>(), started = Promise.withResolvers<void>();
	let budget: BridgeByteBudget | undefined;
	ios.native.readConfig = async () => { started.resolve(); return pending.promise; };
	const app = service({ ios }, { createVideo: (options) => { budget = options.budget; return createVideoHandoff(options); } });
	app.createGroup("g"); app.connect("a", "g");
	const opening = app.open("a", "ios").catch((error) => error);
	await started.promise;
	let done = false; const closing = app.closeGroup("g").then(() => { done = true; });
	expect(() => app.createGroup("g")).toThrow("closing");
	await Promise.resolve(); expect(done).toBe(false);
	pending.resolve({ width: 400, height: 800, orientation: "portrait" });
	expect(await opening).toMatchObject({ code: "closed" }); await closing;
	expect(budget!.used).toBe(0); expect(ios.detached()).toBe(0);
	app.createGroup("g"); expect(app.hasGroup("g")).toBe(true);
});

test("delivery identity and byte invalidation belong to the selected view", async () => {
	const ios = device(), app = service({ ios }); app.createGroup("g"); app.connect("a", "g"); app.connect("b", "g");
	const first = await app.open("a", "ios"), second = await app.open("b", "ios");
	const firstRead = app.read("a", first.leaseId), secondRead = app.read("b", second.leaseId);
	ios.emit(avccEnvelope(1, new Uint8Array([1, 2, 3, 4]))); ios.emit(avccEnvelope(2, new Uint8Array([9])));
	const [a, b] = await Promise.all([firstRead, secondRead]);
	expect(a).toMatchObject({ leaseId: first.leaseId, device: "ios" });
	expect(b).toMatchObject({ leaseId: second.leaseId, device: "ios" });
	await app.closeConnection("a");
	expect(a.bytes.length).toBe(0); expect(b.bytes.length).toBeGreaterThan(0);
	b.release(); await app.closeGroup("g"); expect(ios.detached()).toBe(2);
});

test("budget releases are idempotent and input batches enforce bounds before dispatch", () => {
	const budget = createBridgeByteBudget(20), release = budget.reserve(12);
	expect(budget.used).toBe(12); expect(() => budget.reserve(9)).toThrow("limit");
	release(); release(); expect(budget.used).toBe(0);
	const input = batch({ leaseId: "lease", device: "ios", config: { revision: 1 } });
	expect(parseWorkspaceInput(input).sequence).toBe(1);
	expect(() => parseWorkspaceInput({ ...input, events: Array.from({ length: 33 }, () => input.events[0]) })).toThrow("valid");
	expect(() => parseWorkspaceInput({ ...input, padding: "x".repeat(WORKSPACE_LIMITS.inputBytes) })).toThrow("16 KiB");
});

test("connections isolate lease IDs and eight-lease bounds include pending attachments", async () => {
	const ios = device(), android = device("android"), app = service({ ios, android });
	const first = await app.open("a", "ios");
	await expect(app.config("b", first.leaseId)).rejects.toThrow("another");
	expect(() => app.input("a", { ...batch(first), device: "android" })).toThrow("another");
	for (let index = 0; index < 7; index++) await app.open("a", "ios");
	await expect(app.open("a", "android")).rejects.toThrow("eight");
	await app.open("b", "android");
	await app.closeConnection("a");
	expect(ios.detached()).toBe(8); expect(android.detached()).toBe(0);
});

test("complete gesture validation, config revision and input results prevent replay", async () => {
	const ios = device(), app = service({ ios }), lease = await app.open("a", "ios");
	const invalid = batch(lease, 1, [{ kind: "touch", phase: "move", x: 0.2, y: 0.4 }]);
	expect((await app.input("a", invalid)).dispatch).toBe("none"); expect(ios.frames).toHaveLength(0);
	const accepted = batch(lease, 2);
	expect((await app.input("a", accepted)).dispatch).toBe("applied");
	expect((await app.input("a", accepted)).dispatch).toBe("applied"); expect(ios.frames).toHaveLength(2);
	expect(() => app.input("a", { ...accepted, batchId: "different" })).toThrow("consumed");
	expect(() => app.input("a", batch(lease, 1))).toThrow("consumed");
	ios.config({ width: 800, height: 400, orientation: "landscape_left" });
	expect((await app.input("a", batch(lease, 3))).dispatch).toBe("none"); expect(ios.frames).toHaveLength(2);
	const next = { ...lease, config: await app.config("a", lease.leaseId) };
	expect(next.config.revision).toBe(2);
	expect((await app.input("a", batch(next, 4))).dispatch).toBe("applied");
});

test.each(["landscape_left", "landscape_right", "portrait_upside_down"])("iOS %s input maps display coordinates once and close releases original gesture", async (orientation) => {
	const ios = device(); ios.config({ width: 400, height: 800, orientation });
	const app = service({ ios }), lease = await app.open("a", "ios");
	const expected = orientation === "landscape_left" ? { x: 0.7, y: 0.8 } : orientation === "landscape_right" ? { x: 0.30000000000000004, y: 0.2 } : { x: 0.8, y: 0.30000000000000004 };
	expect((await app.input("a", batch(lease, 1, [{ kind: "touch", phase: "begin", x: 0.2, y: 0.7 }]))).dispatch).toBe("applied");
	expect(ios.frames[0]!.value).toMatchObject(expected);
	await app.close("a", lease.leaseId);
	expect(ios.frames[1]!.value).toMatchObject({ type: "end", ...expected });
	expect(ios.owner()).toBeUndefined(); expect(ios.detached()).toBe(1);
});

test("Android canonical display input and existing landscape iOS frames avoid a second rotation", async () => {
	for (const platform of ["android", "ios"] as const) {
		const native = device(platform); native.config({ width: 800, height: 400, orientation: "landscape_left" });
		const app = service({ native }), lease = await app.open("a", "native");
		await app.input("a", batch(lease));
		expect(native.frames[0]!.value).toMatchObject({ x: 0.2, y: 0.7 });
	}
});

test("native failure is unknown, releases keys and never repeats the uncertain batch", async () => {
	const ios = device(); let failures = 0;
	ios.dispatch(async (frame) => { if (frame[0] === 6 && JSON.parse(frame.subarray(1).toString()).type === "down") { failures += 1; throw new Error("Lost native reply"); } });
	const app = service({ ios }), lease = await app.open("a", "ios");
	const input = batch(lease, 1, [{ kind: "key", phase: "down", usage: 4 }]);
	expect((await app.input("a", input)).dispatch).toBe("unknown");
	expect(ios.frames.map((frame) => frame.value.type)).toEqual(["down", "up"]);
	expect((await app.input("a", input)).dispatch).toBe("unknown"); expect(failures).toBe(1);
	expect(ios.owner()).toBeUndefined();
});

test("one native batch and one pending batch bound a device while other devices proceed", async () => {
	const ios = device(), android = device("android"), completion = Promise.withResolvers<void>();
	let first = true; ios.dispatch(async () => { if (first) { first = false; await completion.promise; } });
	const app = service({ ios, android }), lease = await app.open("a", "ios"), other = await app.open("a", "android");
	const active = app.input("a", batch(lease, 1));
	await Promise.resolve(); await Promise.resolve();
	const pending = app.input("a", batch(lease, 2));
	expect(() => app.input("a", batch(lease, 3))).toThrow("pending");
	expect((await app.input("a", batch(other))).dispatch).toBe("applied");
	completion.resolve();
	expect((await active).dispatch).toBe("applied"); expect((await pending).dispatch).toBe("applied");
	expect(ios.frames).toHaveLength(4);
});

test("cancellation waits for original native input, releases it, and skips remaining events", async () => {
	const ios = device(), completion = Promise.withResolvers<void>(), started = Promise.withResolvers<void>();
	let first = true; ios.dispatch(async () => { if (first) { first = false; started.resolve(); await completion.promise; } });
	const app = service({ ios }), lease = await app.open("a", "ios"), cancel = new AbortController();
	const input = app.input("a", batch(lease), cancel.signal);
	await started.promise; cancel.abort();
	expect(ios.owner()).toBe(lease.leaseId);
	completion.resolve(); expect((await input).dispatch).toBe("unknown");
	expect(ios.frames.map((value) => value.value.type)).toEqual(["begin", "end"]); expect(ios.owner()).toBeUndefined();
});

test("close and idle expiry release only subscriptions and unblock a pending video read", async () => {
	const callbacks = new Set<() => void>(), ios = device(), android = device("android");
	const app = service({ ios, android }, { schedule: (run, milliseconds) => { expect(milliseconds).toBe(WORKSPACE_LIMITS.idleMs); callbacks.add(run); return () => { callbacks.delete(run); }; } });
	const lease = await app.open("a", "ios"); await app.open("b", "android");
	const read = app.read("a", lease.leaseId).then(() => new Error("Unexpected video delivery"), (error: Error) => error);
	await app.closeConnection("a"); expect((await read).message).toContain("closed");
	expect(ios.detached()).toBe(1); expect(android.detached()).toBe(0);
	for (const run of callbacks) run();
	await app.dispose(); expect(android.detached()).toBe(1);
});

test("existing video uses original AVCC source and releases its delivery budget", async () => {
	const ios = device(), app = service({ ios }), lease = await app.open("a", "ios");
	const read = app.read("a", lease.leaseId);
	ios.emit(avccEnvelope(1, new Uint8Array([1, 2, 3, 4]))); ios.emit(avccEnvelope(2, new Uint8Array([9, 8, 7])));
	const delivery = await read; expect(delivery.reset).toBe(true); expect(delivery.mimeType).toBe("application/x-agentsims-avcc"); expect(delivery.bytes.length).toBe(17);
	delivery.release(); await app.close("a", lease.leaseId); expect(ios.detached()).toBe(1);
});
