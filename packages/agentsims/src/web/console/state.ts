import type {
	LogCursor,
	LogEvent,
	LogGap,
	LogLevel,
	LogRead,
	LogRecord,
	LogSource,
	LogSourceStatus,
	LogTarget,
} from "../../core/tools/logs/contracts";

export const CONSOLE_LIMITS = Object.freeze({
	records: 2_000,
	bytes: 1_024 * 1_024,
	totalBytes: 8 * 1_024 * 1_024,
	selectedRecords: 200,
	selectedBytes: 64 * 1_024,
	channels: 32,
});
export const CONSOLE_SOURCES: readonly LogSource[] = [
	"ios-native",
	"android-native",
	"react-native",
];
export const CONSOLE_LEVELS: readonly LogLevel[] = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
];
export const sourceLabel = (source: LogSource) =>
	({
		"ios-native": "iOS",
		"android-native": "Android",
		"react-native": "React Native",
	})[source];

export type ConsoleDevice = {
	readonly id: string;
	readonly name: string;
	readonly platform: "ios" | "android";
	readonly currentApp?: {
		readonly id: string;
		readonly name?: string;
		readonly pid?: number;
	};
	readonly projectId?: string;
	readonly reactNative?: LogTarget["reactNative"];
};
export type ConsoleScope = "device" | "all";
export type ConsoleFilters = {
	appMode: "foreground" | "fixed";
	fixedApp: string;
	query: string;
	level: LogLevel;
	sources: readonly LogSource[];
};
export type ConsoleOptions = {
	paused: boolean;
	follow: boolean;
	timestamps: boolean;
	wrap: boolean;
};
export type ConsoleSession = {
	filters: ConsoleFilters;
	options: ConsoleOptions;
	records: readonly LogRecord[];
	frozen: readonly LogRecord[] | null;
	selected: readonly LogRecord[];
	statuses: readonly LogSourceStatus[];
	cursor?: LogCursor;
	gap?: LogGap;
	localDropped: number;
	connection: "connecting" | "live" | "reconnecting" | "closed" | "error";
	error: string | null;
	scrollTop: number;
	anchor?: { id: string; offset: number };
};

const encoder = new TextEncoder();
const byteSizes = new WeakMap<LogRecord, number>();
const filteredViews = new WeakMap<
	ConsoleSession,
	{
		records: readonly LogRecord[];
		filters: ConsoleFilters;
		visible: readonly LogRecord[];
	}
>();
const viewVersions = new WeakMap<ConsoleSession, number>();
function invalidateView(session: ConsoleSession): void {
	const cache = filteredViews.get(session);
	if (
		cache &&
		(cache.records !== (session.frozen ?? session.records) ||
			cache.filters !== session.filters)
	)
		filteredViews.delete(session);
	viewVersions.set(session, (viewVersions.get(session) ?? 0) + 1);
}
// Allocate pause once. The remaining budget holds fresh occurrences for Resume.
const pauseBudget = {
	records: CONSOLE_LIMITS.records - 128,
	bytes: CONSOLE_LIMITS.bytes - 128 * 1_024,
	totalBytes: CONSOLE_LIMITS.totalBytes - 1_024 * 1_024,
};
export function recordBytes(record: LogRecord): number {
	const cached = byteSizes.get(record);
	if (cached !== undefined) return cached;
	const bytes = encoder.encode(JSON.stringify(record)).byteLength;
	if (Object.isFrozen(record)) byteSizes.set(record, bytes);
	return bytes;
}
function immutableRecord(record: LogRecord): LogRecord {
	return Object.freeze({
		...record,
		cursor: Object.freeze({ ...record.cursor }),
		...(record.sourceTime
			? { sourceTime: Object.freeze({ ...record.sourceTime }) }
			: {}),
	});
}
function retained(session: ConsoleSession): LogRecord[] {
	return [
		...new Map(
			[...session.records, ...(session.frozen ?? []), ...session.selected].map(
				(record) => [record.id, record],
			),
		).values(),
	];
}
function createSession(): ConsoleSession {
	return {
		filters: {
			appMode: "foreground",
			fixedApp: "",
			query: "",
			level: "info",
			sources: [...CONSOLE_SOURCES],
		},
		options: { paused: false, follow: true, timestamps: false, wrap: true },
		records: [],
		frozen: null,
		selected: [],
		statuses: [],
		localDropped: 0,
		connection: "closed",
		error: null,
		scrollTop: 0,
	};
}
export function sessionBytes(session: ConsoleSession): number {
	return retained(session).reduce(
		(bytes, record) => bytes + recordBytes(record),
		0,
	);
}
export function visibleRecords(session: ConsoleSession): readonly LogRecord[] {
	const records = session.frozen ?? session.records;
	const cached = filteredViews.get(session);
	if (cached?.records === records && cached.filters === session.filters)
		return cached.visible;
	const visible = records.filter((record) =>
		recordMatches(record, session.filters),
	);
	filteredViews.set(session, { records, filters: session.filters, visible });
	return visible;
}
/** Match the common query contract: minimum severity, exact app, and case-insensitive text. */
export function recordMatches(
	record: LogRecord,
	filters: ConsoleFilters,
): boolean {
	if (
		!filters.sources.includes(record.source) ||
		CONSOLE_LEVELS.indexOf(record.level) < CONSOLE_LEVELS.indexOf(filters.level)
	)
		return false;
	if (filters.appMode === "fixed" && record.app !== filters.fixedApp.trim())
		return false;
	const needle = filters.query.toLowerCase();
	return (
		!needle ||
		[record.message, record.stack, record.tag, record.process].some((value) =>
			value?.toLowerCase().includes(needle),
		)
	);
}
export function consoleTarget(
	device: ConsoleDevice,
	filters: ConsoleFilters,
): LogTarget | null {
	if (filters.appMode === "fixed" && !filters.fixedApp.trim()) return null;
	return {
		device: device.id,
		app:
			filters.appMode === "foreground"
				? { mode: "foreground" }
				: { mode: "fixed", id: filters.fixedApp.trim() },
		projectId: device.projectId,
		reactNative: device.reactNative,
	};
}

/** Immutable occurrences are retained separately from display filtering and stream cursors. */
export class ConsoleStore {
	private readonly sessions = new Map<string, ConsoleSession>();
	private readonly received = new Map<string, Map<string, number>>();
	private historyViews = new WeakMap<
		ConsoleSession,
		{
			records: readonly LogRecord[];
			frozen: readonly LogRecord[] | null;
			selected: readonly LogRecord[];
			allFrozen: readonly LogRecord[] | null;
			allSelected: readonly LogRecord[];
			history: readonly LogRecord[];
		}
	>();
	private readonly all = createSession();
	private aggregateInputs: string | null = null;
	private devices = new Set<string>();
	aggregate(): ConsoleSession {
		return this.all;
	}
	private view(device: string | null): ConsoleSession {
		return device === null ? this.all : this.session(device);
	}
	session(device: string): ConsoleSession {
		let session = this.sessions.get(device);
		if (!session) {
			session = createSession();
			this.sessions.set(device, session);
		}
		return session;
	}
	retainDevices(ids: readonly string[]): void {
		this.historyViews = new WeakMap();
		const allowed = new Set(ids);
		this.devices = allowed;
		this.all.selected = this.all.selected.filter((record) =>
			allowed.has(record.device),
		);
		if (this.all.frozen) {
			this.all.frozen = this.all.frozen.filter((record) =>
				allowed.has(record.device),
			);
			invalidateView(this.all);
		}
		// A hidden phone keeps its bounded channel. Evict only old inactive metadata.
		for (const id of allowed) {
			const session = this.sessions.get(id);
			if (session) {
				this.sessions.delete(id);
				this.sessions.set(id, session);
			}
		}
		for (const id of this.sessions.keys()) {
			if (this.sessions.size <= Math.max(CONSOLE_LIMITS.channels, allowed.size))
				break;
			if (!allowed.has(id)) {
				this.sessions.delete(id);
				this.received.delete(id);
			}
		}
		this.synchronizeAggregate();
	}
	private channelHistory(device: string): readonly LogRecord[] {
		const session = this.session(device);
		const cached = this.historyViews.get(session);
		if (
			cached &&
			cached.records === session.records &&
			cached.frozen === session.frozen &&
			cached.selected === session.selected &&
			cached.allFrozen === this.all.frozen &&
			cached.allSelected === this.all.selected
		)
			return cached.history;
		const history = [
			...new Map(
				[
					...session.records,
					...(session.frozen ?? []),
					...session.selected,
					...(this.all.frozen ?? []).filter(
						(record) => record.device === device,
					),
					...this.all.selected.filter((record) => record.device === device),
				].map((record) => [record.id, record]),
			).values(),
		];
		this.historyViews.set(session, {
			records: session.records,
			frozen: session.frozen,
			selected: session.selected,
			allFrozen: this.all.frozen,
			allSelected: this.all.selected,
			history,
		});
		return history;
	}
	/** Export original channel history. Display filters and Pause do not remove evidence. */
	history(device: string | null): readonly LogRecord[] {
		const records =
			device === null
				? [...this.devices].flatMap((id) => this.channelHistory(id))
				: [...this.channelHistory(device)];
		return records.sort(
			(left, right) =>
				left.receivedAt - right.receivedAt ||
				left.device.localeCompare(right.device) ||
				left.cursor.sequence - right.cursor.sequence,
		);
	}
	historyCount(device: string | null): number {
		return device === null
			? [...this.devices].reduce(
					(count, id) => count + this.channelHistory(id).length,
					0,
				)
			: this.channelHistory(device).length;
	}
	filters(device: string | null, change: Partial<ConsoleFilters>): void {
		const session = this.view(device);
		session.filters = {
			...session.filters,
			...change,
			...(change.query !== undefined
				? { query: change.query.slice(0, 4096) }
				: {}),
			...(change.fixedApp !== undefined
				? { fixedApp: change.fixedApp.trim().slice(0, 512) }
				: {}),
			...(change.sources ? { sources: [...change.sources] } : {}),
		};
		invalidateView(session);
	}
	options(device: string | null, change: Partial<ConsoleOptions>): void {
		const session = this.view(device);
		if (
			change.paused !== undefined &&
			change.paused !== session.options.paused
		) {
			session.frozen = change.paused ? this.pauseSnapshot(session) : null;
			invalidateView(session);
		}
		session.options = { ...session.options, ...change };
		if (session === this.all && session.frozen)
			session.records = session.frozen;
		this.bound();
		this.boundAggregate();
	}
	private pauseSnapshot(session: ConsoleSession): readonly LogRecord[] {
		const pinned = new Map(
			[...this.sessions.values(), this.all]
				.flatMap((view) => [
					...(view === session ? [] : (view.frozen ?? [])),
					...view.selected,
				])
				.map((record) => [record.id, record]),
		);
		const counts = new Map<string, number>();
		const sizes = new Map<string, number>();
		let total = 0;
		for (const record of pinned.values()) {
			counts.set(record.device, (counts.get(record.device) ?? 0) + 1);
			sizes.set(
				record.device,
				(sizes.get(record.device) ?? 0) + recordBytes(record),
			);
			total += recordBytes(record);
		}
		const anchor =
			session.anchor &&
			session.records.findIndex((record) => record.id === session.anchor!.id);
		// Preserve the reading position when capped; otherwise retain recent history.
		const candidates =
			anchor !== undefined && anchor >= 0
				? [
						...session.records.slice(anchor),
						...session.records.slice(0, anchor).reverse(),
					]
				: [...session.records].reverse();
		const keep = new Set<string>();
		let bytes = 0;
		for (const record of candidates) {
			const size = recordBytes(record);
			const extra = pinned.has(record.id) ? 0 : size;
			const count = (counts.get(record.device) ?? 0) + (extra ? 1 : 0);
			const deviceBytes = (sizes.get(record.device) ?? 0) + extra;
			if (
				keep.size >= pauseBudget.records ||
				bytes + size > pauseBudget.bytes ||
				(extra &&
					(count > pauseBudget.records ||
						deviceBytes > pauseBudget.bytes ||
						total + extra > pauseBudget.totalBytes))
			)
				continue;
			keep.add(record.id);
			bytes += size;
			if (extra) {
				pinned.set(record.id, record);
				counts.set(record.device, count);
				sizes.set(record.device, deviceBytes);
				total += extra;
			}
		}
		session.localDropped += session.records.length - keep.size;
		return session.records.filter((record) => keep.has(record.id));
	}
	connection(
		device: string,
		connection: ConsoleSession["connection"],
		error: string | null = null,
	): void {
		const session = this.session(device);
		session.connection = connection;
		session.error = error;
	}
	read(device: string, read: LogRead): void {
		this.event(device, { type: "records", ...read });
		this.session(device).statuses = read.statuses
			.filter((status) => status.device === device)
			.map((status) => Object.freeze({ ...status }));
	}
	event(device: string, event: LogEvent): void {
		const session = this.session(device);
		if (event.type === "status") {
			if (event.status.device !== device) return;
			session.statuses = [
				...session.statuses.filter(
					(status) => status.source !== event.status.source,
				),
				Object.freeze({ ...event.status }),
			];
			return;
		}
		if (
			session.cursor?.epoch === event.cursor.epoch &&
			session.cursor.sequence > event.cursor.sequence
		)
			return;
		if (session.cursor && session.cursor.epoch !== event.cursor.epoch) {
			session.gap = {
				reason: "reconnect",
				requested: { ...session.cursor },
				oldest: { ...event.cursor },
				dropped: null,
			};
		}
		if (event.type === "reset") {
			session.gap = {
				reason: event.reason === "restart" ? "reset" : event.reason,
				requested: { ...(session.cursor ?? event.cursor) },
				oldest: { ...event.cursor },
				dropped: null,
			};
		} else {
			const known = new Set(session.records.map((record) => record.id));
			const received = this.received.get(device);
			const incoming = event.records.filter((record) => {
				if (
					record.device !== device ||
					record.cursor.sequence > event.cursor.sequence ||
					known.has(record.id) ||
					record.cursor.sequence <=
						(received?.get(record.cursor.epoch) ?? -1) ||
					(session.cursor?.epoch === event.cursor.epoch &&
						record.cursor.sequence <= session.cursor.sequence)
				)
					return false;
				known.add(record.id);
				return true;
			});
			if (incoming.length) {
				session.records = [
					...session.records,
					...incoming.map(immutableRecord),
				];
				invalidateView(session);
			}
			this.remember(device, incoming);
			if (event.gap)
				session.gap = {
					...event.gap,
					requested: { ...event.gap.requested },
					...(event.gap.oldest ? { oldest: { ...event.gap.oldest } } : {}),
				};
		}
		session.cursor = Object.freeze({ ...event.cursor });
		this.bound();
	}
	private remember(device: string, records: readonly LogRecord[]): void {
		const received = this.received.get(device) ?? new Map<string, number>();
		for (const record of records) {
			const sequence = Math.max(
				record.cursor.sequence,
				received.get(record.cursor.epoch) ?? -1,
			);
			received.delete(record.cursor.epoch);
			received.set(record.cursor.epoch, sequence);
		}
		// Original occurrence epochs only: empty reconnect frames cannot grow this map.
		while (received.size > CONSOLE_LIMITS.records + 1)
			received.delete(received.keys().next().value!);
		this.received.set(device, received);
	}
	clear(device: string | null): void {
		if (device === null) for (const id of this.devices) this.clear(id);
		const session = this.view(device);
		if (device !== null) {
			this.remember(device, this.channelHistory(device));
			this.all.records = this.all.records.filter(
				(record) => record.device !== device,
			);
			if (this.all.frozen)
				this.all.frozen = this.all.frozen.filter(
					(record) => record.device !== device,
				);
			this.all.selected = this.all.selected.filter(
				(record) => record.device !== device,
			);
			invalidateView(this.all);
		}
		this.historyViews = new WeakMap();
		session.records = [];
		session.frozen = session.options.paused ? [] : null;
		session.selected = [];
		invalidateView(session);
		session.gap = undefined;
		session.localDropped = 0;
		session.scrollTop = 0;
		session.anchor = undefined;
		// The receipt cursor stays in place so reconnect cannot replay a cleared view.
	}
	select(device: string | null, records: readonly LogRecord[]): boolean {
		const originals = new Map(
			retained(this.view(device)).map((record) => [record.id, record]),
		);
		const unique = [
			...new Map(
				records
					.filter(
						(record) =>
							(device === null
								? this.devices.has(record.device)
								: record.device === device) && originals.has(record.id),
					)
					.map((record) => [record.id, originals.get(record.id)!]),
			).values(),
		];
		if (
			unique.length > CONSOLE_LIMITS.selectedRecords ||
			unique.reduce((sum, record) => sum + recordBytes(record), 0) >
				CONSOLE_LIMITS.selectedBytes
		)
			return false;
		const otherSelections =
			[...this.sessions.entries()]
				.filter(([id]) => id !== device)
				.flatMap(([, session]) => session.selected)
				.reduce((sum, record) => sum + recordBytes(record), 0) +
			(device === null
				? 0
				: this.all.selected.reduce(
						(sum, record) => sum + recordBytes(record),
						0,
					));
		if (
			otherSelections +
				unique.reduce((sum, record) => sum + recordBytes(record), 0) >
			CONSOLE_LIMITS.totalBytes
		)
			return false;
		this.view(device).selected = unique.map(immutableRecord);
		this.bound();
		this.boundAggregate();
		return true;
	}
	/** Combine real device occurrences. No aggregate cursor or transport device is invented. */
	synchronizeAggregate(): void {
		const sessions = [...this.sessions.entries()].filter(([device]) =>
			this.devices.has(device),
		);
		const inputs = JSON.stringify(
			sessions.map(([device, session]) => [
				device,
				viewVersions.get(session) ?? 0,
			]),
		);
		let recordsChanged = false;
		if (this.all.frozen) {
			recordsChanged = this.all.records !== this.all.frozen;
			this.all.records = this.all.frozen;
			this.aggregateInputs = null;
		} else if (inputs !== this.aggregateInputs) {
			this.all.records = sessions
				.flatMap(([, session]) => session.records)
				.sort(
					(left, right) =>
						left.receivedAt - right.receivedAt ||
						left.device.localeCompare(right.device) ||
						left.cursor.sequence - right.cursor.sequence,
				);
			this.aggregateInputs = inputs;
			invalidateView(this.all);
			recordsChanged = true;
		}
		this.all.statuses = sessions.flatMap(([, session]) => session.statuses);
		const errors = sessions.filter(([, session]) => session.error);
		this.all.error = errors.length
			? errors
					.map(([device, session]) => `${device}: ${session.error}`)
					.join("\n")
			: null;
		this.all.connection = errors.length
			? "error"
			: sessions.some(([, session]) => session.connection === "reconnecting")
				? "reconnecting"
				: sessions.some(([, session]) => session.connection === "connecting")
					? "connecting"
					: sessions.some(([, session]) => session.connection === "live")
						? "live"
						: "closed";
		if (recordsChanged) this.boundAggregate();
		else
			this.all.localDropped = Math.max(
				this.all.localDropped,
				sessions.reduce((sum, [, session]) => sum + session.localDropped, 0),
			);
	}
	private boundAggregate(): void {
		const records = retained(this.all).sort(
			(left, right) =>
				left.receivedAt - right.receivedAt || left.id.localeCompare(right.id),
		);
		const pinned = new Set(
			[...this.all.selected, ...(this.all.frozen ?? [])].map(
				(record) => record.id,
			),
		);
		let count = records.length;
		let bytes = records.reduce((sum, record) => sum + recordBytes(record), 0);
		const removed = new Set<string>();
		for (const record of records) {
			if (count <= CONSOLE_LIMITS.records && bytes <= CONSOLE_LIMITS.bytes)
				break;
			if (pinned.has(record.id)) continue;
			removed.add(record.id);
			count--;
			bytes -= recordBytes(record);
		}
		if (removed.size) {
			this.all.records = this.all.records.filter(
				(record) => !removed.has(record.id),
			);
			if (this.all.frozen)
				this.all.frozen = this.all.frozen.filter(
					(record) => !removed.has(record.id),
				);
			invalidateView(this.all);
		}
		this.all.localDropped =
			removed.size +
			[...this.sessions.entries()]
				.filter(([device]) => this.devices.has(device))
				.reduce((sum, [, session]) => sum + session.localDropped, 0);
	}
	private bound(): void {
		// Cached export views must not keep occurrences after retention evicts them.
		this.historyViews = new WeakMap();
		const candidates: { device: string; record: LogRecord; bytes: number }[] =
			[];
		const counts = new Map<string, number>();
		const sizes = new Map<string, number>();
		let total = 0;
		for (const [device, session] of this.sessions) {
			const records = [
				...new Map(
					[
						...retained(session),
						...(this.all.frozen ?? []),
						...this.all.selected,
					]
						.filter((record) => record.device === device)
						.map((record) => [record.id, record]),
				).values(),
			];
			const pinned = new Set(
				[
					...session.selected,
					...this.all.selected,
					...(session.frozen ?? []),
					...(this.all.frozen ?? []),
				]
					.filter((record) => record.device === device)
					.map((record) => record.id),
			);
			const bytes = records.reduce(
				(sum, record) => sum + recordBytes(record),
				0,
			);
			counts.set(device, records.length);
			sizes.set(device, bytes);
			total += bytes;
			for (const record of records)
				if (!pinned.has(record.id))
					candidates.push({ device, record, bytes: recordBytes(record) });
		}
		candidates.sort(
			(left, right) =>
				left.record.receivedAt - right.record.receivedAt ||
				left.record.id.localeCompare(right.record.id),
		);
		const removed = new Map<string, Set<string>>();
		for (const candidate of candidates) {
			const count = counts.get(candidate.device)!;
			const bytes = sizes.get(candidate.device)!;
			if (
				count <= CONSOLE_LIMITS.records &&
				bytes <= CONSOLE_LIMITS.bytes &&
				total <= CONSOLE_LIMITS.totalBytes
			)
				continue;
			const ids = removed.get(candidate.device) ?? new Set<string>();
			ids.add(candidate.record.id);
			removed.set(candidate.device, ids);
			counts.set(candidate.device, count - 1);
			sizes.set(candidate.device, bytes - candidate.bytes);
			total -= candidate.bytes;
		}
		for (const [device, ids] of removed) {
			const session = this.session(device);
			session.records = session.records.filter((record) => !ids.has(record.id));
			this.all.records = this.all.records.filter(
				(record) => !ids.has(record.id),
			);
			invalidateView(session);
			invalidateView(this.all);
			session.localDropped += ids.size;
		}
	}
}

export function copyRecords(records: readonly LogRecord[]): string {
	return records
		.map((record) => {
			const time =
				record.sourceTime?.text ??
				`received ${new Date(record.receivedAt).toISOString()}`;
			const identity = [
				record.device,
				record.source,
				record.level,
				record.app,
				record.pid === undefined ? undefined : `pid=${record.pid}`,
				record.tag,
			]
				.filter((value) => value !== undefined)
				.join(" ");
			return `[${time}] ${identity}: ${record.message}${record.stack ? `\n${record.stack}` : ""}${record.truncated ? "\n[truncated by source]" : ""}`;
		})
		.join("\n");
}

/** Follow only when the user has chosen it. A saved row anchor handles eviction above the viewport. */
export function scrollPosition(options: {
	follow: boolean;
	paused: boolean;
	scrollTop: number;
	scrollHeight: number;
	viewportHeight: number;
	anchor?: { id: string; offset: number };
	rows: readonly { id: string; top: number }[];
}): number {
	if (options.follow && !options.paused)
		return Math.max(0, options.scrollHeight - options.viewportHeight);
	const row =
		options.anchor && options.rows.find((row) => row.id === options.anchor!.id);
	return Math.max(
		0,
		row ? row.top + options.anchor!.offset : options.scrollTop,
	);
}
