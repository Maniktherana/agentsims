import {
	createBridgeByteBudget, parseWorkspaceInput, WORKSPACE_LIMITS, WorkspaceError,
	type BridgeByteBudget, type WorkspaceInputBatch, type WorkspaceInputEvent,
	type WorkspaceInputResult, type WorkspaceScreenConfig, type WorkspaceVideoHandoff,
	type WorkspaceVideoRead, type WorkspaceVideoDelivery,
} from "./contracts";
import { createVideoHandoff } from "./video";
import type { AvccSink } from "../../stream/avcc-wire";

export type WorkspaceDevice = {
	platform: "ios" | "android";
	readConfig(): Promise<Omit<WorkspaceScreenConfig, "device" | "platform" | "revision">>;
	subscribeAvcc(sink: AvccSink): Promise<() => void>;
	subscribeJpeg?(sink: (bytes: Uint8Array) => void): Promise<() => void>;
	requestKeyframe(): Promise<void>;
	reserveInput(owner: string): boolean;
	releaseInput(owner: string): void;
	dispatchInputFrame(frame: Buffer, owner: string): Promise<void>;
};
export type WorkspaceLeaseInfo = {
	leaseId: string; device: string; codec: "avcc" | "jpeg"; config: WorkspaceScreenConfig;
};
export type WorkspaceLeaseDelivery = WorkspaceVideoDelivery & { leaseId: string; device: string };
export type WorkspaceSessionsOptions = {
	resolve(device: string): Promise<WorkspaceDevice>;
	createVideo?: typeof createVideoHandoff;
	/** Test clocks still use the frozen public idle duration. */
	schedule?: (run: () => void, milliseconds: number) => () => void;
	connectionBytes?: number;
	onGroupClosed?(group: string): void;
};
type HeldInput = { touch?: WorkspaceInputEvent & { kind: "touch" }; multi?: WorkspaceInputEvent & { kind: "multi-touch" }; keys: Set<number> };
type Lease = {
	info: WorkspaceLeaseInfo;
	connection: Connection;
	ready: Promise<void>;
	device?: WorkspaceDevice;
	video: WorkspaceVideoHandoff;
	detach?: () => void;
	closed: boolean;
	closing?: Promise<void>;
	configRelease?: () => void;
	held: HeldInput;
	heldConfig?: { value: WorkspaceScreenConfig; release: () => void };
	last?: { sequence: number; json: string; promise: Promise<WorkspaceInputResult>; release: () => void };
};
type Group = {
	id: string; budget: BridgeByteBudget; connections: Map<string, Connection>;
	retainedResponses: number;
	closed: boolean; idleGeneration: number; cancelIdle?: () => void; closing?: Promise<void>;
};
type Connection = {
	owner: string; group: Group; budget: BridgeByteBudget; leases: Map<string, Lease>;
	closed: boolean; idleGeneration: number; cancelIdle?: () => void; closing?: Promise<void>;
};
type InputQueue = { active?: Promise<unknown>; pending: boolean };

function identity(value: string): void {
	if (!value || value.length > 256 || [...value].some((char) => char.codePointAt(0)! < 32 || char.codePointAt(0) === 127))
		throw new WorkspaceError("invalid", "Use a valid workspace or device ID.");
}
function frame(tag: number, value: unknown): Buffer {
	return Buffer.concat([Buffer.from([tag]), Buffer.from(JSON.stringify(value))]);
}
function rawPoint(config: WorkspaceScreenConfig, x: number, y: number) {
	if (config.platform === "android") return { x, y };
	if (config.orientation.startsWith("landscape") && config.width > config.height) return { x, y };
	switch (config.orientation) {
		case "landscape_left": return { x: y, y: 1 - x };
		case "landscape_right": return { x: 1 - y, y: x };
		case "portrait_upside_down": return { x: 1 - x, y: 1 - y };
		default: return { x, y };
	}
}
function inputFrame(event: WorkspaceInputEvent, config: WorkspaceScreenConfig): Buffer {
	switch (event.kind) {
		case "touch": return frame(3, { type: event.phase === "cancel" && config.platform === "ios" ? "end" : event.phase, ...rawPoint(config, event.x, event.y), edge: event.edge ? 1 : 0 });
		case "multi-touch": {
			const first = rawPoint(config, event.touches[0]!.x, event.touches[0]!.y);
			const second = rawPoint(config, event.touches[1]!.x, event.touches[1]!.y);
			return frame(5, { type: event.phase === "cancel" && config.platform === "ios" ? "end" : event.phase, x1: first.x, y1: first.y, x2: second.x, y2: second.y });
		}
		case "key": return frame(6, { type: event.phase, usage: event.usage });
		case "crown": return frame(10, { delta: event.delta });
		case "scroll": {
			let { dx, dy } = event;
			if (config.platform === "ios" && !(config.orientation.startsWith("landscape") && config.width > config.height)) {
				if (config.orientation === "landscape_left") [dx, dy] = [dy, -dx];
				else if (config.orientation === "landscape_right") [dx, dy] = [-dy, dx];
				else if (config.orientation === "portrait_upside_down") [dx, dy] = [-dx, -dy];
			}
			return frame(11, { dx, dy, ...rawPoint(config, event.x, event.y) });
		}
	}
}
function validateGesture(events: WorkspaceInputEvent[], held: HeldInput, platform: "ios" | "android"): void {
	let touch = Boolean(held.touch), multi = Boolean(held.multi);
	const keys = new Set(held.keys);
	for (const event of events) {
		if (event.kind === "crown" && platform !== "ios") throw new WorkspaceError("unavailable", "Digital crown input requires iOS.");
		if (event.kind === "touch" || event.kind === "multi-touch") {
			const active = event.kind === "touch" ? touch : multi;
			if ((event.phase === "begin" && (touch || multi)) || (event.phase !== "begin" && !active))
				throw new WorkspaceError("invalid", "Use a complete workspace gesture sequence.");
			const next = event.phase === "begin" || event.phase === "move";
			if (event.kind === "touch") touch = next; else multi = next;
		}
		if (event.kind === "key") {
			if (event.phase === "down") keys.add(event.usage); else keys.delete(event.usage);
			if (keys.size > 32) throw new WorkspaceError("bounds", "The workspace has too many held keys.");
		}
	}
}

/** Connection leases borrow platform sessions; they never own a device or server. */
export function makeWorkspaceSessions(options: WorkspaceSessionsOptions) {
	const groups = new Map<string, Group>();
	const connections = new Map<string, Connection>();
	const inputQueues = new Map<string, InputQueue>();
	let disposed = false;
	let disposing: Promise<void> | undefined;
	const schedule = options.schedule ?? ((run, milliseconds) => {
		const timer = setTimeout(run, milliseconds); timer.unref?.();
		return () => clearTimeout(timer);
	});
	const touchGroup = (group: Group) => {
		group.cancelIdle?.();
		const generation = ++group.idleGeneration;
		if (group.retainedResponses > 0 || group.closed) return;
		group.cancelIdle = schedule(() => {
			if (!group.closed && group.idleGeneration === generation) void closeGroup(group.id);
		}, WORKSPACE_LIMITS.idleMs);
	};
	const touchConnection = (connection: Connection) => {
		connection.cancelIdle?.();
		const generation = ++connection.idleGeneration;
		connection.cancelIdle = schedule(() => {
			if (!connection.closed && connection.idleGeneration === generation) void closeConnection(connection.owner);
		}, WORKSPACE_LIMITS.idleMs);
		touchGroup(connection.group);
	};
	const createGroup = (id: string): void => {
		identity(id);
		if (disposed) throw new WorkspaceError("closed", "The workspace service is closed.");
		let group = groups.get(id);
		if (!group) {
			group = { id, budget: createBridgeByteBudget(options.connectionBytes), connections: new Map(), closed: false, idleGeneration: 0, retainedResponses: 0 };
			groups.set(id, group);
		}
		if (group.closed) throw new WorkspaceError("closed", "The workspace group is closing.");
		touchGroup(group);
	};
	const connect = (owner: string, id: string): void => {
		identity(owner); identity(id);
		if (disposed) throw new WorkspaceError("closed", "The workspace service is closed.");
		const group = groups.get(id);
		if (!group || group.closed) throw new WorkspaceError("closed", "The workspace group is closed or unavailable.");
		let connection = connections.get(owner);
		if (connection && connection.group !== group) throw new WorkspaceError("invalid", "The workspace connection belongs to another group.");
		if (!connection) {
			if (group.connections.size >= WORKSPACE_LIMITS.leases) throw new WorkspaceError("bounds", "The workspace group already has eight views.");
			connection = { owner, group, budget: group.budget, leases: new Map(), closed: false, idleGeneration: 0 };
			connections.set(owner, connection);
			group.connections.set(owner, connection);
		}
		if (connection.closed) throw new WorkspaceError("closed", "The workspace connection is closing.");
		touchConnection(connection);
	};
	const connectionFor = (owner: string, create = false) => {
		identity(owner);
		if (disposed) throw new WorkspaceError("closed", "The workspace service is closed.");
		if (!connections.has(owner) && create) { createGroup(owner); connect(owner, owner); }
		const connection = connections.get(owner);
		if (!connection || connection.closed || connection.group.closed) throw new WorkspaceError("closed", "The workspace connection is closed.");
		touchConnection(connection);
		return connection;
	};
	const assertLeaseOpen = (lease: Lease): void => {
		if (disposed || lease.closed || lease.connection.closed || lease.connection.group.closed)
			throw new WorkspaceError("closed", "The workspace lease is closed.");
	};
	const leaseFor = (owner: string, leaseId: string) => {
		identity(leaseId);
		const connection = connections.get(owner);
		const lease = connection?.leases.get(leaseId);
		if (disposed || !connection || connection.closed || connection.group.closed || !lease || lease.closed)
			throw new WorkspaceError("closed", "This workspace lease is closed or belongs to another connection.");
		touchConnection(connection);
		return lease;
	};
	const updateConfig = async (lease: Lease): Promise<WorkspaceScreenConfig> => {
		assertLeaseOpen(lease);
		const current = await lease.device!.readConfig();
		assertLeaseOpen(lease);
		if (!Number.isFinite(current.width) || !Number.isFinite(current.height) || current.width <= 0 || current.height <= 0 || typeof current.orientation !== "string" || current.orientation.length > 128)
			throw new WorkspaceError("unavailable", "The device screen configuration is unavailable.");
		const old = lease.info.config;
		const changed = old.width !== current.width || old.height !== current.height || old.orientation !== current.orientation || old.presentationGeneration !== current.presentationGeneration;
		const config = { device: lease.info.device, platform: lease.device!.platform, ...current, revision: old.revision + Number(changed) };
		const bytes = Buffer.byteLength(JSON.stringify(config));
		if (bytes > WORKSPACE_LIMITS.metadataBytes) throw new WorkspaceError("bounds", "The workspace configuration exceeds 16 KiB.");
		const release = lease.connection.budget.reserve(bytes);
		lease.configRelease?.(); lease.configRelease = release;
		lease.info.config = config;
		return { ...config };
	};
	const releaseInput = async (lease: Lease) => {
		if (!lease.device) return;
		const events: WorkspaceInputEvent[] = [];
		if (lease.held.touch) events.push({ ...lease.held.touch, phase: "cancel" });
		if (lease.held.multi) events.push({ ...lease.held.multi, phase: "cancel" });
		for (const usage of lease.held.keys) events.push({ kind: "key", phase: "up", usage });
		try {
			for (const event of events) {
				try { await lease.device.dispatchInputFrame(inputFrame(event, lease.heldConfig?.value ?? lease.info.config), lease.info.leaseId); } catch { /* Release only this lease's original device. */ }
			}
		} finally {
			lease.held = { keys: new Set() };
			lease.heldConfig?.release(); lease.heldConfig = undefined;
			lease.device.releaseInput(lease.info.leaseId);
		}
	};
	const closeLease = (lease: Lease): Promise<void> => {
		if (lease.closing) return lease.closing;
		lease.closed = true;
		lease.closing = Promise.resolve().then(async () => {
			await lease.ready.catch(() => {});
			await lease.last?.promise.catch(() => {});
			try { await releaseInput(lease); } finally {
				try { lease.detach?.(); } finally {
					try { lease.video.close(); } finally {
						lease.configRelease?.(); lease.last?.release();
						lease.connection.leases.delete(lease.info.leaseId);
					}
				}
			}
		});
		lease.video.close();
		return lease.closing;
	};
	function closeConnection(owner: string, expectedGroup?: string): Promise<void> {
		const connection = connections.get(owner);
		if (!connection) return Promise.resolve();
		if (expectedGroup !== undefined && connection.group.id !== expectedGroup)
			throw new WorkspaceError("invalid", "The workspace connection belongs to another group.");
		if (connection.closing) return connection.closing;
		connection.closed = true; connection.cancelIdle?.();
		connection.closing = Promise.resolve().then(async () => {
			await Promise.allSettled([...connection.leases.values()].map(closeLease));
			connections.delete(owner);
			connection.group.connections.delete(owner);
		});
		return connection.closing;
	}
	function closeGroup(id: string): Promise<void> {
		const group = groups.get(id);
		if (!group) return Promise.resolve();
		if (group.closing) return group.closing;
		group.closed = true; group.cancelIdle?.();
		group.closing = Promise.resolve().then(async () => {
			await Promise.allSettled([...group.connections.keys()].map((owner) => closeConnection(owner)));
			try { options.onGroupClosed?.(id); } finally { groups.delete(id); }
		});
		return group.closing;
	}
	const open = async (owner: string, device: string, codec: "avcc" | "jpeg" = "avcc"): Promise<WorkspaceLeaseInfo> => {
		identity(device);
		if (codec !== "avcc" && codec !== "jpeg") throw new WorkspaceError("invalid", "Select an AVCC or JPEG workspace stream.");
		const connection = connectionFor(owner, true);
		let count = 0;
		for (const view of connection.group.connections.values()) count += view.leases.size;
		if (count >= WORKSPACE_LIMITS.leases) throw new WorkspaceError("bounds", "The workspace group already has eight device leases.");
		const leaseId = crypto.randomUUID();
		const video = (options.createVideo ?? createVideoHandoff)({ codec, budget: connection.budget, requestKeyframe: async () => { await lease.device?.requestKeyframe(); } });
		const lease: Lease = {
			info: { leaseId, device, codec, config: { device, platform: "ios", width: 0, height: 0, orientation: "portrait", revision: 0 } },
			connection, video, ready: Promise.resolve(), closed: false, held: { keys: new Set() },
		};
		connection.leases.set(leaseId, lease);
		lease.ready = Promise.resolve().then(async () => {
			assertLeaseOpen(lease);
			lease.device = await options.resolve(device);
			assertLeaseOpen(lease);
			await updateConfig(lease);
			assertLeaseOpen(lease);
			if (codec === "jpeg") {
				if (lease.device.platform !== "ios" || !lease.device.subscribeJpeg) throw new WorkspaceError("unavailable", "This device has no existing JPEG stream.");
				lease.detach = await lease.device.subscribeJpeg((bytes) => video.acceptJpeg(bytes));
			} else lease.detach = await lease.device.subscribeAvcc(video.sink);
		});
		try {
			await lease.ready;
			assertLeaseOpen(lease);
			return { ...lease.info, config: { ...lease.info.config } };
		} catch (error) { await closeLease(lease); throw error; }
	};
	const input = (owner: string, value: unknown, signal?: AbortSignal): Promise<WorkspaceInputResult> => {
		const batch: WorkspaceInputBatch = parseWorkspaceInput(value);
		const lease = leaseFor(owner, batch.leaseId);
		if (batch.device !== lease.info.device) throw new WorkspaceError("invalid", "Workspace input belongs to another device.");
		const json = JSON.stringify(batch);
		if (lease.last && batch.sequence <= lease.last.sequence) {
			if (batch.sequence === lease.last.sequence && lease.last.json === json) return lease.last.promise;
			throw new WorkspaceError("stale", "This workspace input sequence has already been consumed.");
		}
		if (batch.sequence !== (lease.last?.sequence ?? 0) + 1) throw new WorkspaceError("stale", "Use the next workspace input sequence.");
		const queue = inputQueues.get(batch.device) ?? { pending: false };
		if (queue.active && queue.pending) throw new WorkspaceError("busy", "The device already has a pending workspace input batch.");
		const release = lease.connection.budget.reserve(Buffer.byteLength(json));
		const prior = queue.active;
		if (prior) queue.pending = true;
		inputQueues.set(batch.device, queue);
		const result = (dispatch: WorkspaceInputResult["dispatch"], message?: string): WorkspaceInputResult => ({ batchId: batch.batchId, sequence: batch.sequence, dispatch, ...(message ? { message } : {}) });
		const run = async (): Promise<WorkspaceInputResult> => {
			await lease.ready;
			if (prior) await prior.catch(() => {});
			queue.pending = false;
			if (lease.closed || lease.connection.closed || signal?.aborted) return result("none", "The workspace input was cancelled before dispatch.");
			await updateConfig(lease);
			if (batch.configRevision !== lease.info.config.revision) { await releaseInput(lease); return result("none", "The workspace screen configuration changed. Read it before sending input."); }
			validateGesture(batch.events, lease.held, lease.device!.platform);
			if (!lease.device!.reserveInput(lease.info.leaseId)) return result("none", "Another browser or command owns device input.");
			let started = false;
			try {
				if (!lease.heldConfig) {
					const value = { ...lease.info.config };
					lease.heldConfig = { value, release: lease.connection.budget.reserve(Buffer.byteLength(JSON.stringify(value))) };
				}
				for (const event of batch.events) {
					if (signal?.aborted || lease.closed) return result(started ? "unknown" : "none", "Workspace input was cancelled. Observe the device before another action.");
					const releaseFrame = lease.connection.budget.reserve(Buffer.byteLength(JSON.stringify(event)) + 256);
					const encoded = inputFrame(event, lease.heldConfig.value);
					if (event.kind === "touch" && (event.phase === "begin" || event.phase === "move")) lease.held.touch = event;
					if (event.kind === "multi-touch" && (event.phase === "begin" || event.phase === "move")) lease.held.multi = event;
					if (event.kind === "key" && event.phase === "down") lease.held.keys.add(event.usage);
					started = true;
					try { await lease.device!.dispatchInputFrame(encoded, lease.info.leaseId); } finally { releaseFrame(); }
					if (event.kind === "touch" && (event.phase === "end" || event.phase === "cancel")) delete lease.held.touch;
					if (event.kind === "multi-touch" && (event.phase === "end" || event.phase === "cancel")) delete lease.held.multi;
					if (event.kind === "key" && event.phase === "up") lease.held.keys.delete(event.usage);
				}
				return result(signal?.aborted ? "unknown" : "applied");
			} catch (error) {
				await releaseInput(lease);
				return result(started ? "unknown" : "none", error instanceof Error ? error.message : "Workspace input failed.");
			} finally {
				if (signal?.aborted || lease.closed) await releaseInput(lease);
				else if (!lease.held.touch && !lease.held.multi && lease.held.keys.size === 0) {
					lease.heldConfig?.release(); lease.heldConfig = undefined;
					lease.device!.releaseInput(lease.info.leaseId);
				}
			}
		};
		const promise = run().catch((error) => result("none", error instanceof Error ? error.message : "Workspace input failed."));
		const previous = lease.last;
		if (previous) void previous.promise.finally(previous.release);
		lease.last = { sequence: batch.sequence, json, promise, release };
		queue.active = promise;
		void promise.finally(() => { if (queue.active === promise) { queue.active = undefined; if (!queue.pending) inputQueues.delete(batch.device); } });
		return promise;
	};
	return {
		createGroup,
		connect,
		hasGroup: (group: string) => !disposed && Boolean(groups.get(group) && !groups.get(group)!.closed),
		hasConnection: (owner: string, group: string) => {
			const connection = connections.get(owner);
			return !disposed && Boolean(connection && !connection.closed && !connection.group.closed && connection.group.id === group);
		},
		open,
		config: async (owner: string, leaseId: string) => { const lease = leaseFor(owner, leaseId); await lease.ready; return updateConfig(lease); },
		read: async (owner: string, leaseId: string, request?: WorkspaceVideoRead): Promise<WorkspaceLeaseDelivery> => {
			const lease = leaseFor(owner, leaseId);
			await lease.ready;
			assertLeaseOpen(lease);
			const delivery = await lease.video.read(request);
			try { assertLeaseOpen(lease); } catch (error) { delivery.release(); throw error; }
			return Object.assign(delivery, { leaseId: lease.info.leaseId, device: lease.info.device });
		},
		input,
		close: (owner: string, leaseId: string) => closeLease(leaseFor(owner, leaseId)),
		closeConnection,
		closeGroup,
		/** Adapter copies share the same connection budget as native handoffs. */
		reserveBytes: (owner: string, bytes: number) => connectionFor(owner).budget.reserve(bytes),
		/** Output acknowledgement owns this charge even after the view expires. */
		retainBytes: (owner: string, bytes: number) => {
			const group = connectionFor(owner).group;
			const charge = group.budget.reserve(bytes);
			group.retainedResponses++;
			touchGroup(group);
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				charge();
				group.retainedResponses--;
				if (!group.closed) touchGroup(group);
			};
			return Object.assign(release, { resize: charge.resize });
		},
		dispose: () => {
			disposed = true;
			return disposing ??= Promise.resolve().then(async () => { await Promise.allSettled([...groups.keys()].map(closeGroup)); });
		},
	};
}
