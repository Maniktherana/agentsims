import { InvalidCommandInput } from "../errors";
import {
	LOG_LIMITS,
	type LogCursor,
	type LogGap,
	type LogRead,
	type LogRecord,
	type LogRecordInput,
	type LogSource,
	type LogSourceStatus,
} from "./contracts";
import {
	logRecordBytes,
	normalizeLogRecord,
	normalizeLogStatus,
} from "./normalize";
import {
	logDevice,
	logRecordMatches,
	logStatusMatches,
	parseLogQuery,
} from "./query";

type EntryRecord = {
	readonly record: LogRecord;
	readonly bytes: number;
	readonly order: number;
};
type DeviceBuffer = {
	epoch: string;
	sequence: number;
	records: EntryRecord[];
	bytes: number;
	statuses: Map<LogSource, LogSourceStatus>;
	readers: number;
	lastReadAt: number;
	gapReason: "reset" | "reconnect" | "retention";
};

function epoch(device: string): string {
	return `${encodeURIComponent(device)}~${crypto.randomUUID()}`;
}

/** The owning Effect scope supplies the idle timer and calls dispose. */
export class LogStore {
	private readonly devices = new Map<string, DeviceBuffer>();
	private bytes = 0;
	private order = 0;
	private disposed = false;

	constructor(private readonly now: () => number = Date.now) {}

	private entry(device: string): DeviceBuffer {
		if (this.disposed) throw new Error("Log storage is closed");
		logDevice(device);
		this.expireIdle();
		const existing = this.devices.get(device);
		if (existing) return existing;
		const entry: DeviceBuffer = {
			epoch: epoch(device),
			sequence: 0,
			records: [],
			bytes: 0,
			statuses: new Map(),
			readers: 0,
			lastReadAt: this.now(),
			gapReason: "reset",
		};
		this.devices.set(device, entry);
		return entry;
	}

	private removeOldest(entry: DeviceBuffer): void {
		const oldest = entry.records.shift();
		if (!oldest) return;
		entry.bytes -= oldest.bytes;
		this.bytes -= oldest.bytes;
	}

	append(input: LogRecordInput): LogRecord {
		const entry = this.entry(input.device);
		const record = normalizeLogRecord(
			input,
			{ epoch: entry.epoch, sequence: entry.sequence + 1 },
			this.now(),
		);
		entry.sequence += 1;
		const bytes = logRecordBytes(record);
		entry.records.push({ record, bytes, order: ++this.order });
		entry.bytes += bytes;
		this.bytes += bytes;
		while (
			entry.records.length > LOG_LIMITS.recordsPerDevice ||
			entry.bytes > LOG_LIMITS.bytesPerDevice
		)
			this.removeOldest(entry);
		while (this.bytes > LOG_LIMITS.bytesTotal) {
			let oldest: DeviceBuffer | undefined;
			for (const candidate of this.devices.values()) {
				if (
					candidate.records.length &&
					(!oldest || candidate.records[0]!.order < oldest.records[0]!.order)
				)
					oldest = candidate;
			}
			if (!oldest) break;
			this.removeOldest(oldest);
		}
		return record;
	}

	setStatus(input: LogSourceStatus): LogSourceStatus {
		const status = normalizeLogStatus(input);
		this.entry(status.device).statuses.set(status.source, status);
		return status;
	}

	read(input: unknown): LogRead {
		const query = parseLogQuery(input);
		const entry = this.entry(query.device);
		entry.lastReadAt = this.now();
		const after = query.after;
		if (after?.epoch === entry.epoch && after.sequence > entry.sequence)
			throw new InvalidCommandInput({
				message: "Log cursor is ahead of this device",
			});
		const oldest = entry.records[0]?.record.cursor;
		const firstAvailableSequence = oldest?.sequence ?? entry.sequence + 1;
		let gap: LogGap | undefined;
		if (after && after.epoch !== entry.epoch) {
			gap = Object.freeze({
				reason: entry.gapReason,
				requested: after,
				oldest,
				dropped: null,
			});
		} else if (after && after.sequence < firstAvailableSequence - 1) {
			gap = Object.freeze({
				reason: "retention",
				requested: after,
				oldest,
				dropped: firstAvailableSequence - after.sequence - 1,
			});
		}
		const candidates = entry.records
			.map(({ record }) => record)
			.filter(
				(record) =>
					(!after ||
						after.epoch !== entry.epoch ||
						record.cursor.sequence > after.sequence) &&
					logRecordMatches(record, query),
			);
		const records = after
			? candidates.slice(0, query.limit)
			: candidates.slice(-query.limit);
		const hasMore = after !== undefined && candidates.length > records.length;
		// Initial snapshots select recent records. Follow-up pages consume all matching records.
		const cursor: LogCursor = Object.freeze({
			epoch: entry.epoch,
			sequence: hasMore ? records.at(-1)!.cursor.sequence : entry.sequence,
		});
		return Object.freeze({
			records: Object.freeze(records),
			statuses: Object.freeze(
				[...entry.statuses.values()].filter((status) =>
					logStatusMatches(status, query),
				),
			),
			cursor,
			dropped: gap?.dropped ?? 0,
			gap,
			hasMore,
		});
	}

	/** Clear this device only. Old cursor holders receive an explicit reset gap. */
	clear(device: string): LogCursor {
		const entry = this.entry(device);
		this.bytes -= entry.bytes;
		entry.records = [];
		entry.bytes = 0;
		entry.epoch = epoch(device);
		entry.gapReason = "reset";
		return Object.freeze({ epoch: entry.epoch, sequence: entry.sequence });
	}

	/** Keep history across a collector reconnect. IDs and occurrence data remain unchanged. */
	markReconnect(device: string): LogCursor {
		return this.markSourceGap(device, "reconnect");
	}

	/** Unknown collector loss changes the epoch without editing retained occurrences. */
	markSourceGap(device: string, reason: "reconnect" | "retention"): LogCursor {
		const entry = this.entry(device);
		entry.epoch = epoch(device);
		entry.gapReason = reason;
		return Object.freeze({ epoch: entry.epoch, sequence: entry.sequence });
	}

	/** A stream holds a reader lease until its Effect scope closes. Release is idempotent. */
	retainReader(device: string): () => void {
		const entry = this.entry(device);
		entry.readers += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			entry.readers -= 1;
			entry.lastReadAt = this.now();
		};
	}

	expireIdle(): readonly string[] {
		const expired: string[] = [];
		const now = this.now();
		for (const [device, entry] of this.devices) {
			if (entry.readers === 0 && now - entry.lastReadAt >= LOG_LIMITS.idleMs) {
				this.bytes -= entry.bytes;
				this.devices.delete(device);
				expired.push(device);
			}
		}
		return Object.freeze(expired);
	}

	usage(): {
		readonly bytes: number;
		readonly devices: readonly {
			readonly device: string;
			readonly bytes: number;
			readonly records: number;
		}[];
	} {
		this.expireIdle();
		return Object.freeze({
			bytes: this.bytes,
			devices: Object.freeze(
				[...this.devices].map(([device, entry]) =>
					Object.freeze({
						device,
						bytes: entry.bytes,
						records: entry.records.length,
					}),
				),
			),
		});
	}

	dispose(): void {
		this.devices.clear();
		this.bytes = 0;
		this.disposed = true;
	}
}
