import type { AxSnapshot } from "./accessibility-model";
import {
	buildAxView,
	flattenAxView,
	type AxPlatform,
	type AxViewNode,
} from "./ax-view";

export interface DeviceSnapshot {
	id: string;
	device: string;
	platform: AxPlatform;
	app: string | null;
	screen: { width: number; height: number; orientation: string };
	nodes: AxViewNode[];
	shown: number;
	total: number;
	refs: Record<string, string>;
	warnings: string[];
}

export interface RecordSnapshotInput {
	device: string;
	platform: AxPlatform;
	snapshot: AxSnapshot;
	screen: { width: number; height: number; orientation: string };
	app: string | null;
	all: boolean;
}

export interface ObservationTicket {
	device: string;
	session: number;
	revision: number;
	sequence: number;
}

export interface SnapshotVersion {
	session: number;
	revision: number;
	observation: string | null;
}

export type ProvenanceFailureReason =
	| "invalid"
	| "wrong_device"
	| "unknown";

export type RefResolution =
	| { ok: true; node: AxViewNode; observation: DeviceSnapshot }
	| {
			ok: false;
			reason: ProvenanceFailureReason;
			current: DeviceSnapshot | null;
			observation: number | null;
	  };

export interface CaptureRecord {
	id: string;
	device: string;
	observation: string | null;
	screen: { width: number; height: number };
	orientation: string | null;
	generation: number | null;
}

export type CaptureFailureReason =
	| ProvenanceFailureReason
	| "unpublished"
	| "failed"
	| "stale";

export type CaptureResolution =
	| { ok: true; capture: CaptureRecord }
	| { ok: false; reason: CaptureFailureReason };

export interface SnapshotStore {
	beginObservation(device: string): ObservationTicket;
	publishObservation(
		ticket: ObservationTicket,
		input: Omit<RecordSnapshotInput, "device">,
	): DeviceSnapshot | null;
	failObservation(ticket: ObservationTicket): boolean;
	current(device: string): DeviceSnapshot | null;
	normalized(device: string): AxSnapshot | null;
	version(device: string): SnapshotVersion;
	isCurrent(device: string, version: SnapshotVersion): boolean;
	resolveRef(device: string, ref: string): RefResolution;
	invalidate(device: string): void;
	mutate(device: string): void;
	beginCapture(device: string): string;
	publishCapture(
		capture: string,
		input: {
			screen: { width: number; height: number };
			orientation?: string | null;
			generation?: number | null;
			observation?: string | null;
		},
	): CaptureRecord | null;
	failCapture(capture: string): boolean;
	resolveCapture(device: string, capture: string): CaptureResolution;
}

interface CaptureDraft {
	id: string;
	session: number;
	revision: number;
	observation: string | null;
	status: "pending" | "failed" | "published";
	record: CaptureRecord | null;
}

interface DeviceEntry {
	session: number;
	revision: number;
	observationSequence: number;
	latestObservation: number;
	current: DeviceSnapshot | null;
	normalized: AxSnapshot | null;
	refs: Map<string, AxViewNode>;
	captures: Map<string, CaptureDraft>;
}

const CAPTURE_HISTORY_LIMIT = 16;

const REF_PATTERN = /^e[1-9]\d*$/;
const CAPTURE_PATTERN = /^c[1-9]\d*$/;

function token(value: string, pattern: RegExp): string | null {
	const normalized = value.startsWith("@") ? value.slice(1) : value;
	return pattern.test(normalized) ? normalized : null;
}

export function isRefIdentifier(value: string): boolean {
	return token(value, REF_PATTERN) !== null;
}

export function isCaptureIdentifier(value: string): boolean {
	return token(value, CAPTURE_PATTERN) !== null;
}

export function createSnapshotStore(): SnapshotStore {
	const devices = new Map<string, DeviceEntry>();
	let nextRef = 0;
	let nextCapture = 0;

	const entryFor = (device: string): DeviceEntry => {
		const existing = devices.get(device);
		if (existing) return existing;
		const entry: DeviceEntry = {
			session: 1,
			revision: 0,
			observationSequence: 0,
			latestObservation: 0,
			current: null,
			normalized: null,
			refs: new Map(),
			captures: new Map(),
		};
		devices.set(device, entry);
		return entry;
	};

	const clearPerception = (entry: DeviceEntry) => {
		entry.current = null;
		entry.normalized = null;
		entry.refs.clear();
	};

	const ticketIsCurrent = (entry: DeviceEntry, ticket: ObservationTicket) =>
		entry.session === ticket.session &&
		entry.revision === ticket.revision &&
		entry.latestObservation === ticket.sequence;

	const captureOwner = (id: string): string | null => {
		for (const [device, entry] of devices)
			if (entry.captures.has(id)) return device;
		return null;
	};

	const refOwner = (id: string): string | null => {
		for (const [device, entry] of devices)
			if (entry.refs.has(id)) return device;
		return null;
	};

	const store: SnapshotStore = {
		beginObservation(device) {
			const entry = entryFor(device);
			entry.observationSequence += 1;
			entry.latestObservation = entry.observationSequence;
			return {
				device,
				session: entry.session,
				revision: entry.revision,
				sequence: entry.observationSequence,
			};
		},
		publishObservation(ticket, input) {
			const entry = entryFor(ticket.device);
			if (!ticketIsCurrent(entry, ticket)) return null;
			const view = buildAxView({
				snapshot: input.snapshot,
				platform: input.platform,
				screen: input.screen,
				all: input.all,
				nextRef: () => `e${(nextRef += 1)}`,
			});
			const snapshot: DeviceSnapshot = {
				id: `s${ticket.sequence}`,
				device: ticket.device,
				platform: input.platform,
				app: input.app,
				screen: input.screen,
				nodes: view.nodes,
				shown: view.shown,
				total: view.total,
				refs: view.refs,
				warnings: view.warnings,
			};
			entry.refs = new Map(
				flattenAxView(view.nodes).map((node) => [node.ref, node]),
			);
			entry.current = snapshot;
			entry.normalized = input.snapshot;
			return snapshot;
		},
		failObservation(ticket) {
			const entry = entryFor(ticket.device);
			if (!ticketIsCurrent(entry, ticket)) return false;
			clearPerception(entry);
			return true;
		},
		current(device) {
			return devices.get(device)?.current ?? null;
		},
		normalized(device) {
			return devices.get(device)?.normalized ?? null;
		},
		version(device) {
			const entry = entryFor(device);
			return {
				session: entry.session,
				revision: entry.revision,
				observation: entry.current?.id ?? null,
			};
		},
		isCurrent(device, version) {
			const entry = devices.get(device);
			return (
				entry !== undefined &&
				entry.session === version.session &&
				entry.revision === version.revision &&
				(entry.current?.id ?? null) === version.observation
			);
		},
		resolveRef(device, ref) {
			const id = token(ref, REF_PATTERN);
			const current = devices.get(device)?.current ?? null;
			if (!id)
				return { ok: false, reason: "invalid", current, observation: null };
			const entry = devices.get(device);
			const node = entry?.refs.get(id);
			if (node && entry?.current)
				return { ok: true, node, observation: entry.current };
			if (refOwner(id))
				return { ok: false, reason: "wrong_device", current, observation: null };
			return { ok: false, reason: "unknown", current, observation: null };
		},
		invalidate(device) {
			const entry = entryFor(device);
			entry.session += 1;
			entry.revision = 0;
			clearPerception(entry);
		},
		mutate(device) {
			const entry = entryFor(device);
			entry.revision += 1;
			clearPerception(entry);
		},
		beginCapture(device) {
			const entry = entryFor(device);
			const id = `c${(nextCapture += 1)}`;
			entry.captures.set(id, {
				id,
				session: entry.session,
				revision: entry.revision,
				observation: entry.current?.id ?? null,
				status: "pending",
				record: null,
			});
			while (entry.captures.size > CAPTURE_HISTORY_LIMIT) {
				const oldest = entry.captures.keys().next().value;
				if (oldest === undefined) break;
				entry.captures.delete(oldest);
			}
			return id;
		},
		publishCapture(capture, input) {
			const id = token(capture, CAPTURE_PATTERN);
			if (!id) return null;
			const owner = captureOwner(id);
			if (!owner) return null;
			const entry = entryFor(owner);
			const draft = entry.captures.get(id);
			if (!draft || draft.status !== "pending") return null;
			if (
				draft.session !== entry.session ||
				draft.revision !== entry.revision ||
				draft.observation !== (entry.current?.id ?? null)
			) {
				draft.status = "failed";
				return null;
			}
			const observation = Object.hasOwn(input, "observation")
				? (input.observation ?? null)
				: draft.observation;
			if (observation !== null && observation !== entry.current?.id) {
				draft.status = "failed";
				return null;
			}
			const record: CaptureRecord = {
				id,
				device: owner,
				observation,
				screen: input.screen,
				orientation: input.orientation ?? null,
				generation: input.generation ?? null,
			};
			draft.status = "published";
			draft.record = record;
			return record;
		},
		failCapture(capture) {
			const id = token(capture, CAPTURE_PATTERN);
			if (!id) return false;
			const owner = captureOwner(id);
			if (!owner) return false;
			const draft = entryFor(owner).captures.get(id);
			if (!draft || draft.status !== "pending") return false;
			draft.status = "failed";
			return true;
		},
		resolveCapture(device, capture) {
			const id = token(capture, CAPTURE_PATTERN);
			if (!id) return { ok: false, reason: "invalid" };
			const entry = devices.get(device);
			const draft = entry?.captures.get(id);
			if (!entry || !draft) {
				return captureOwner(id)
					? { ok: false, reason: "wrong_device" }
					: { ok: false, reason: "unknown" };
			}
			if (draft.status === "pending")
				return { ok: false, reason: "unpublished" };
			if (draft.status === "failed" || !draft.record)
				return { ok: false, reason: "failed" };
			if (draft.session !== entry.session || draft.revision !== entry.revision)
				return { ok: false, reason: "stale" };
			const bound = draft.record.observation;
			if (bound !== null && bound !== (entry.current?.id ?? null))
				return { ok: false, reason: "stale" };
			return { ok: true, capture: draft.record };
		},
	};
	return store;
}
