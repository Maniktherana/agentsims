import type {
	WorkspaceInputBatch, WorkspaceInputEvent, WorkspaceInputResult, WorkspaceScreenConfig,
} from "../../core/tools/workspace/contracts";
import { parseWorkspaceInput } from "../../core/tools/workspace/contracts";
import type { WorkspaceHostAdapter } from "./workspace-host";

const LIMITS = Object.freeze({ leases: 8, bytes: 16 * 1024 * 1024, frame: 4 * 1024 * 1024, description: 64 * 1024, metadata: 16 * 1024, events: 32 });
const encoder = new TextEncoder();
type RecordValue = Record<string, unknown>;
type Budget = { used: number; leases: number };
const budgets = new WeakMap<WorkspaceHostAdapter, Budget>();

export type WorkspaceTransportSnapshot = Readonly<{
	status: "idle" | "opening" | "ready" | "unavailable" | "closed";
	workspace?: string;
	viewId?: string;
	devices?: unknown;
	/** False after channel loss: remote release remains the backend's EOF/idle responsibility. */
	remoteCleanup?: boolean;
}>;
export type WorkspaceVideoMetadata = Readonly<{
	workspace: string; viewId: string; leaseId: string; device: string;
	cursor: number; epoch: number; reset: boolean;
}>;
export type WorkspaceTransportLeaseInfo = Readonly<{
	workspace: string; viewId: string; leaseId: string; device: string;
	codec: "avcc" | "jpeg"; config: Readonly<WorkspaceScreenConfig>; videoUri: string;
}>;
export type WorkspaceTransportLease = {
	snapshot(): WorkspaceTransportLeaseInfo;
	refreshConfig(): Promise<Readonly<WorkspaceScreenConfig>>;
	/** One stream per lease, with no resource read before consumer demand. */
	video(options?: { onDelivery?: (metadata: WorkspaceVideoMetadata) => void }): ReadableStream<Uint8Array>;
	input(events: readonly WorkspaceInputEvent[]): Promise<WorkspaceInputResult>;
	close(): Promise<void>;
};
export type WorkspaceTransport = {
	snapshot(): WorkspaceTransportSnapshot;
	subscribe(listener: () => void): () => void;
	open(): Promise<WorkspaceTransportSnapshot>;
	openLease(device: string, codec?: "avcc" | "jpeg"): Promise<WorkspaceTransportLease>;
	close(): Promise<void>;
};

function record(value: unknown): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The workspace response is invalid.");
	return value as RecordValue;
}
function id(value: unknown): string {
	if (typeof value !== "string" || !value || value.length > 256 || [...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127)) throw new Error("The workspace identity is invalid.");
	return value;
}
function integer(value: unknown, minimum: number): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new Error("The workspace revision is invalid.");
	return value;
}
function freezeJson<T>(value: T): T {
	if (value && typeof value === "object") {
		for (const child of Object.values(value)) freezeJson(child);
		Object.freeze(value);
	}
	return value;
}
function serializedBytes(value: unknown): number {
	const text = JSON.stringify(value);
	if (typeof text !== "string" || text.length > LIMITS.bytes) throw new Error("The workspace response exceeds 16 MiB.");
	const bytes = encoder.encode(text).length;
	if (bytes > LIMITS.bytes) throw new Error("The workspace response exceeds 16 MiB.");
	return bytes;
}
function reserve(budget: Budget, bytes: number): () => void {
	if (bytes > LIMITS.bytes - budget.used) throw new Error("The workspace connection byte limit is full.");
	budget.used += bytes;
	return () => { budget.used -= bytes; };
}
function toolData(value: unknown): RecordValue {
	serializedBytes(value);
	const result = record(value);
	if (result.isError) throw new Error("The workspace operation failed.");
	return record(result.structuredContent);
}
function screen(value: unknown, device: string, previous?: Readonly<WorkspaceScreenConfig>): Readonly<WorkspaceScreenConfig> {
	const config = record(value);
	if (serializedBytes(config) > LIMITS.metadata || config.device !== device || (config.platform !== "ios" && config.platform !== "android") || typeof config.width !== "number" || !Number.isFinite(config.width) || config.width <= 0 || typeof config.height !== "number" || !Number.isFinite(config.height) || config.height <= 0 || typeof config.orientation !== "string" || !config.orientation || config.orientation.length > 128)
		throw new Error("The device screen configuration is invalid.");
	const revision = integer(config.revision, 1);
	const result: WorkspaceScreenConfig = { device, platform: config.platform, width: config.width, height: config.height, orientation: config.orientation, revision };
	if (config.presentationGeneration !== undefined) result.presentationGeneration = integer(config.presentationGeneration, 1);
	if (previous && (revision < previous.revision || previous.platform !== result.platform || (revision === previous.revision && JSON.stringify(previous) !== JSON.stringify(result)))) throw new Error("The device screen configuration is stale.");
	return Object.freeze(result);
}
function videoUri(workspace: string, viewId: string, leaseId: string): string {
	return `agentsims://workspace/${encodeURIComponent(workspace)}/views/${encodeURIComponent(viewId)}/leases/${encodeURIComponent(leaseId)}/video`;
}
function validateAvcc(bytes: Uint8Array, reset: boolean): void {
	let description = false, frame = false, keyframe = false, metadataBytes = 0;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset < bytes.length;) {
		if (bytes.length - offset < 5) throw new Error("The workspace video envelope is incomplete.");
		const length = view.getUint32(offset, false);
		const tag = bytes[offset + 4];
		const payload = length - 1;
		if (length < 2 || length + 4 > bytes.length - offset) throw new Error("The workspace video envelope is incomplete.");
		if (tag === 1) {
			if (description || frame || payload > LIMITS.description) throw new Error("The workspace decoder description is invalid.");
			description = true;
		} else if (tag === 2 || tag === 3) {
			if (frame || payload > LIMITS.frame) throw new Error("The workspace access unit exceeds its byte limit.");
			frame = true; keyframe = tag === 2;
		} else if (tag === 5 || tag === 6) {
			metadataBytes += payload;
			if (metadataBytes > LIMITS.metadata || (tag === 6 && payload !== 16)) throw new Error("The workspace video metadata is invalid.");
		} else throw new Error("The workspace video envelope has an unknown tag.");
		offset += length + 4;
	}
	if (!frame || (reset && (!description || !keyframe))) throw new Error("The workspace decoder reset is incomplete.");
}

/** App transport only: borrows runtime sessions and never starts or stops a server. */
export function createWorkspaceTransport(host: WorkspaceHostAdapter): WorkspaceTransport {
	const budget = budgets.get(host) ?? { used: 0, leases: 0 };
	budgets.set(host, budget);
	const listeners = new Set<() => void>();
	const leases = new Set<WorkspaceTransportLease>();
	const allocations = new Set<Promise<unknown>>();
	let current: WorkspaceTransportSnapshot = Object.freeze({ status: "idle" });
	let opening: Promise<WorkspaceTransportSnapshot> | undefined;
	let closing: Promise<void> | undefined;
	let closed = false;
	let disconnected = false;
	let workspace: string | undefined;
	let viewId: string | undefined;
	const publish = (next: WorkspaceTransportSnapshot) => {
		current = Object.freeze(next);
		for (const listener of listeners) listener();
	};
	const available = () => {
		if (closed || disconnected || !host.snapshot().connected) throw new Error("The workspace transport is unavailable.");
	};
	const identity = () => ({ workspace: workspace!, viewId: viewId! });
	const checkIdentity = (value: RecordValue, leaseId?: string) => {
		if (value.workspace !== workspace || value.viewId !== viewId || (leaseId !== undefined && value.leaseId !== leaseId)) throw new Error("The workspace response belongs to another view or lease.");
	};
	const tool = async (name: string, args: RecordValue, signal?: AbortSignal) => toolData(await host.callTool(name, args, signal));
	const open = (): Promise<WorkspaceTransportSnapshot> => {
		if (closed) return Promise.reject(new Error("The workspace transport is closed."));
		return opening ??= (async () => {
			await host.connect();
			available();
			if (host.supportsWorkspaceTransport?.() === false) throw new Error("This host cannot proxy workspace tools and resources.");
			publish({ status: "opening" });
			const response = await tool("workspace_open", {});
			workspace = id(response.workspace);
			const capabilities = record(response.capabilities);
			if (capabilities.embeddedTransport !== true || capabilities.workspaceProtocol !== 1) throw new Error("This runtime does not support embedded workspace transport.");
			if (closed || disconnected) throw new Error("The workspace closed during connection.");
			const view = await tool("workspace_view_open", { workspace });
			if (view.workspace !== workspace) throw new Error("The workspace response belongs to another workspace.");
			viewId = id(view.viewId);
			const devices = freezeJson(JSON.parse(JSON.stringify(response.devices)));
			if (!closed) publish({ status: "ready", ...identity(), devices });
			return current;
		})().catch((error) => {
			if (!closed) publish({ status: "unavailable", ...(workspace ? { workspace } : {}) });
			throw error;
		});
	};
	const openLease = async (device: string, codec: "avcc" | "jpeg" = "avcc"): Promise<WorkspaceTransportLease> => {
		id(device);
		if (codec !== "avcc" && codec !== "jpeg") return Promise.reject(new Error("Use an AVCC or JPEG workspace stream."));
		const allocation = (async () => {
			await open(); available();
			if (budget.leases >= LIMITS.leases) throw new Error("The workspace connection already has eight device leases.");
			budget.leases++;
			let counted = true;
			const releaseCount = () => { if (counted) { counted = false; budget.leases--; } };
			let leaseId: string | undefined;
			try {
				const result = await tool("workspace_lease_open", { ...identity(), device, codec });
				checkIdentity(result);
				leaseId = id(result.leaseId);
				if (closed || disconnected) throw new Error("The workspace closed during device attachment.");
				const expectedUri = videoUri(workspace!, viewId!, leaseId);
				if (result.device !== device || result.codec !== codec || result.videoUri !== expectedUri) throw new Error("The workspace lease belongs to another device or codec.");
				let info: WorkspaceTransportLeaseInfo = Object.freeze({ ...identity(), leaseId, device, codec, config: screen(result.config, device), videoUri: expectedUri });
				const lifetime = new AbortController();
				let leaseClosed = false;
				let leaseClosing: Promise<void> | undefined;
				let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
				let streamCreated = false;
				let sequence = 0;
				let inputPending = 0;
				let inputTail = Promise.resolve();
				let uncertain = false;
				const ensureLease = () => { available(); if (leaseClosed) throw new Error("The workspace lease is closed."); };
				const closeLease = (): Promise<void> => leaseClosing ??= (async () => {
					leaseClosed = true;
					lifetime.abort();
					try { streamController?.error(new Error("The workspace lease is closed.")); } catch { /* The stream is already closed. */ }
					try {
						if (!disconnected && host.snapshot().connected) {
							const result = await tool("workspace_lease_close", { ...identity(), leaseId: info.leaseId });
							checkIdentity(result, info.leaseId);
							if (result.closed !== true) throw new Error("The workspace lease did not close.");
						}
					} finally { releaseCount(); leases.delete(lease); }
				})();
				const lease: WorkspaceTransportLease = {
					snapshot: () => info,
					refreshConfig: async () => {
						ensureLease();
						const result = await tool("workspace_lease_config", { ...identity(), leaseId: info.leaseId }, lifetime.signal);
						checkIdentity(result, info.leaseId); ensureLease();
						const config = screen(result.config, device, info.config);
						info = Object.freeze({ ...info, config });
						return config;
					},
					video: (options = {}) => {
						ensureLease();
						if (streamCreated) throw new Error("This workspace lease already has a video reader.");
						streamCreated = true;
						let cursor: number | undefined, epoch: number | undefined;
						return new ReadableStream<Uint8Array>({
							start(controller) { streamController = controller; },
							async pull(controller) {
								let releaseSerialized: (() => void) | undefined, releaseDecoded: (() => void) | undefined;
								try {
									ensureLease();
									const uri = info.videoUri + (cursor === undefined ? "" : `?cursor=${cursor}&epoch=${epoch}`);
									const response = await host.readResource(uri, lifetime.signal);
									ensureLease();
									releaseSerialized = reserve(budget, serializedBytes(response));
									const contents = record(response).contents;
									if (!Array.isArray(contents) || contents.length !== 1) throw new Error("The workspace video response is invalid.");
									const content = record(contents[0]);
									const metadata = record(content._meta);
									checkIdentity(metadata, info.leaseId);
									const nextCursor = integer(metadata.cursor, 1), nextEpoch = integer(metadata.epoch, 1);
									if (content.uri !== uri || metadata.device !== device || typeof metadata.reset !== "boolean" || serializedBytes(metadata) > LIMITS.metadata || (cursor !== undefined && nextCursor <= cursor) || (epoch !== undefined && nextEpoch < epoch) || ((epoch === undefined || nextEpoch !== epoch || nextCursor !== cursor! + 1) && metadata.reset !== true)) throw new Error("The workspace video cursor or reset is invalid.");
									if (content.mimeType !== (codec === "avcc" ? "application/x-agentsims-avcc" : "image/jpeg") || typeof content.blob !== "string" || !content.blob || content.blob.length % 4 !== 0 || content.blob.length > Math.ceil((LIMITS.frame + LIMITS.description + LIMITS.metadata + 20) / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content.blob)) throw new Error("The workspace video blob is invalid.");
									const decodedSize = content.blob.length / 4 * 3 - (content.blob.endsWith("==") ? 2 : content.blob.endsWith("=") ? 1 : 0);
									// Both atob's binary string and the delivered byte array exist during decode.
									releaseDecoded = reserve(budget, decodedSize * 2);
									const binary = atob(content.blob);
									const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
									if (btoa(binary) !== content.blob) throw new Error("The workspace video blob is not canonical base64.");
									if (codec === "avcc") validateAvcc(bytes, metadata.reset);
									else if (bytes.length > LIMITS.frame || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) throw new Error("The workspace JPEG is invalid.");
									const delivery = Object.freeze({ ...identity(), leaseId: info.leaseId, device, cursor: nextCursor, epoch: nextEpoch, reset: metadata.reset });
									options.onDelivery?.(delivery);
									ensureLease(); cursor = nextCursor; epoch = nextEpoch;
									controller.enqueue(bytes);
								} catch (error) {
									controller.error(error);
									void closeLease().catch(() => {});
								} finally { releaseSerialized?.(); releaseDecoded?.(); }
							},
							cancel: () => closeLease(),
						}, { highWaterMark: 0 });
					},
					input: async (events) => {
						if (uncertain) return Promise.reject(new Error("The previous dispatch is unknown. Observe the device and open a new lease."));
						ensureLease();
						if (inputPending >= 2) return Promise.reject(new Error("The workspace already has a pending input batch."));
						if (!Array.isArray(events) || !events.length || events.length > LIMITS.events) return Promise.reject(new Error("Use at most 32 workspace input events."));
						const copied = JSON.parse(JSON.stringify(events)) as WorkspaceInputEvent[];
						const batch: WorkspaceInputBatch = parseWorkspaceInput({ leaseId: info.leaseId, device, configRevision: info.config.revision, batchId: crypto.randomUUID(), sequence: sequence + 1, events: copied });
						const bytes = serializedBytes(batch);
						if (bytes > LIMITS.metadata) return Promise.reject(new Error("The workspace input batch exceeds 16 KiB."));
						const release = reserve(budget, bytes);
						inputPending++;
						const pending = inputTail.then(async (): Promise<WorkspaceInputResult> => {
							if (leaseClosed || closed || disconnected || uncertain) return { batchId: batch.batchId, sequence: batch.sequence, dispatch: "none", message: "The workspace input was cancelled before dispatch." };
							batch.sequence = ++sequence;
							let result: RecordValue;
							try {
								result = await tool("workspace_input", { ...identity(), batch }, lifetime.signal);
								checkIdentity(result, info.leaseId);
								if (result.device !== device || result.batchId !== batch.batchId || result.sequence !== batch.sequence || !["applied", "none", "unknown"].includes(result.dispatch as string) || (result.message !== undefined && (typeof result.message !== "string" || result.message.length > 4096))) throw new Error("The workspace input result is invalid.");
							} catch { result = { dispatch: "unknown", message: "The input result is unknown. Observe the device before another action." }; }
							if (result.dispatch === "unknown") {
								uncertain = true;
								void closeLease().catch(() => {});
							}
							return Object.freeze({ batchId: batch.batchId, sequence: batch.sequence, dispatch: result.dispatch as WorkspaceInputResult["dispatch"], ...(typeof result.message === "string" ? { message: result.message } : {}) });
						}).finally(() => { inputPending--; release(); });
						inputTail = pending.then(() => {});
						return pending;
					},
					close: closeLease,
				};
				leases.add(lease);
				return lease;
			} catch (error) {
				try { if (leaseId && !disconnected && host.snapshot().connected) await tool("workspace_lease_close", { ...identity(), leaseId }); }
				finally { releaseCount(); }
				throw error;
			}
		})();
		allocations.add(allocation);
		void allocation.then(() => allocations.delete(allocation), () => allocations.delete(allocation));
		return allocation;
	};
	const close = (): Promise<void> => closing ??= (async () => {
		closed = true;
		const leaseCloses = [...leases].map((lease) => lease.close());
		await Promise.allSettled([opening, ...allocations, ...leaseCloses]);
		let remoteCleanup = !viewId;
		try {
			if (viewId && !disconnected && host.snapshot().connected) {
				const response = await tool("workspace_close", identity());
				checkIdentity(response);
				remoteCleanup = response.closed === true;
			}
		} finally {
			stopHost(); stopTeardown?.();
			publish({ status: disconnected ? "unavailable" : "closed", ...(workspace ? { workspace } : {}), ...(viewId ? { viewId } : {}), remoteCleanup: disconnected ? false : remoteCleanup });
			listeners.clear();
		}
	})();
	const stopHost = host.subscribe(() => {
		if ((viewId || current.status === "opening") && !host.snapshot().connected) { disconnected = true; void close().catch(() => {}); }
	});
	const stopTeardown = host.subscribeTeardown?.((reason) => {
		if (reason === "disconnected") disconnected = true;
		return close();
	});
	return { snapshot: () => current, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, open, openLease, close };
}
