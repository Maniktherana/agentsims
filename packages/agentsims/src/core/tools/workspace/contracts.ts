import { z } from "zod";
import type { AvccSink } from "../../stream/avcc-wire";

export const WORKSPACE_LIMITS = Object.freeze({
	leases: 8,
	accessUnitBytes: 4 * 1024 * 1024,
	descriptionBytes: 64 * 1024,
	metadataBytes: 16 * 1024,
	connectionBytes: 16 * 1024 * 1024,
	inputEvents: 32,
	inputBytes: 16 * 1024,
	idleMs: 5 * 60 * 1000,
	keyframeIntervalMs: 1000,
});

export const WORKSPACE_RESOURCE_URI = "ui://agentsims/workspace.html";

export class WorkspaceError extends Error {
	constructor(
		readonly code: "invalid" | "closed" | "busy" | "bounds" | "stale" | "unavailable",
		message: string,
	) {
		super(message);
		this.name = "WorkspaceError";
	}
}

/** Every retained buffer, including adapter serialization, holds a reservation. */
export type BridgeByteReservation = (() => void) & { resize(bytes: number): void };
export type BridgeByteBudget = {
	readonly used: number;
	reserve(bytes: number): BridgeByteReservation;
};

export function createBridgeByteBudget(
	limit = WORKSPACE_LIMITS.connectionBytes,
): BridgeByteBudget {
	if (!Number.isSafeInteger(limit) || limit < 0)
		throw new WorkspaceError("invalid", "Use a valid workspace byte limit.");
	let used = 0;
	return {
		get used() { return used; },
		reserve(bytes) {
			if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit - used)
				throw new WorkspaceError("bounds", "The workspace connection byte limit is full.");
			used += bytes;
			let size = bytes;
			let released = false;
			const release = () => {
				if (released) return;
				released = true;
				used -= size;
			};
			release.resize = (next: number) => {
				if (released) throw new WorkspaceError("closed", "The workspace byte reservation is closed.");
				if (!Number.isSafeInteger(next) || next < 0 || next > limit - used + size)
					throw new WorkspaceError("bounds", "The workspace connection byte limit is full.");
				used += next - size;
				size = next;
			};
			return release;
		},
	};
}

export type WorkspaceVideoRead = {
	/** Cursor of the last delivery read by this client. Omit on the first read. */
	cursor?: number;
	/** An older epoch requests a fresh decoder reset, never dependent deltas. */
	epoch?: number;
	signal?: AbortSignal;
};

/** The adapter releases bytes only after its bounded serialized copy is released. */
export type WorkspaceVideoDelivery = {
	bytes: Uint8Array;
	cursor: number;
	epoch: number;
	reset: boolean;
	mimeType: "application/x-agentsims-avcc" | "image/jpeg";
	release(): void;
};

export type WorkspaceVideoHandoff = {
	readonly sink: AvccSink;
	readonly epoch: number;
	readonly cursor: number;
	read(request?: WorkspaceVideoRead): Promise<WorkspaceVideoDelivery>;
	/** A complete JPEG from the existing native subscription, not a new capture. */
	acceptJpeg(bytes: Uint8Array): void;
	close(): void;
};

export type WorkspaceVideoOptions = {
	codec: "avcc" | "jpeg";
	budget: BridgeByteBudget;
	requestKeyframe(): Promise<void>;
	now?: () => number;
};

const identity = z.string().min(1).max(256).refine(
	(value) => [...value].every((character) => {
		const code = character.codePointAt(0)!;
		return code >= 32 && code !== 127;
	}),
	"Use an ID without control characters.",
);
const coordinate = z.number().finite().min(0).max(1);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const phase = z.enum(["begin", "move", "end", "cancel"]);
export const WorkspaceInputEventSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("touch"), phase, x: coordinate, y: coordinate, edge: z.boolean().optional() }).strict(),
	z.object({ kind: z.literal("multi-touch"), phase, touches: z.array(point).length(2) }).strict(),
	z.object({ kind: z.literal("key"), phase: z.enum(["down", "up"]), usage: z.number().int().min(0).max(65535) }).strict(),
	z.object({ kind: z.literal("scroll"), dx: z.number().finite().min(-16).max(16), dy: z.number().finite().min(-16).max(16), x: coordinate, y: coordinate }).strict(),
	z.object({ kind: z.literal("crown"), delta: z.number().finite().min(-1000).max(1000) }).strict(),
]);

export const WorkspaceInputBatchSchema = z.object({
	leaseId: identity,
	device: identity,
	configRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
	batchId: identity,
	sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
	events: z.array(WorkspaceInputEventSchema).min(1).max(WORKSPACE_LIMITS.inputEvents),
}).strict();
export type WorkspaceInputEvent = z.infer<typeof WorkspaceInputEventSchema>;
export type WorkspaceInputBatch = z.infer<typeof WorkspaceInputBatchSchema>;

export function parseWorkspaceInput(value: unknown): WorkspaceInputBatch {
	let serialized: string;
	try { serialized = JSON.stringify(value); } catch {
		throw new WorkspaceError("invalid", "Use a valid workspace input batch.");
	}
	if (typeof serialized !== "string" || new TextEncoder().encode(serialized).length > WORKSPACE_LIMITS.inputBytes)
		throw new WorkspaceError("bounds", "The workspace input batch exceeds 16 KiB.");
	const result = WorkspaceInputBatchSchema.safeParse(value);
	if (!result.success)
		throw new WorkspaceError("invalid", "Use a valid workspace input batch.");
	return result.data;
}

export type WorkspaceScreenConfig = {
	device: string;
	platform: "ios" | "android";
	width: number;
	height: number;
	orientation: string;
	revision: number;
	presentationGeneration?: number;
};

export type WorkspaceInputResult = {
	batchId: string;
	sequence: number;
	dispatch: "applied" | "none" | "unknown";
	message?: string;
};
