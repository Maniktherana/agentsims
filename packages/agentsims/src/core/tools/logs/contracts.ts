export const LOG_SOURCES = [
	"ios-native",
	"android-native",
	"react-native",
] as const;
export const LOG_LEVELS = [
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
] as const;

export type LogSource = (typeof LOG_SOURCES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_LIMITS = Object.freeze({
	recordsPerDevice: 2_000,
	bytesPerDevice: 1_024 * 1_024,
	bytesTotal: 8 * 1_024 * 1_024,
	idleMs: 5 * 60 * 1_000,
	messageCharacters: 4_096,
	stackBytes: 16 * 1_024,
});

export type LogTarget = {
	readonly device: string;
	readonly app:
		| { readonly mode: "foreground" }
		| { readonly mode: "fixed"; readonly id: string; readonly pid?: number };
	readonly projectId?: string;
	readonly reactNative?: {
		readonly projectId: string;
		readonly metroUrl: string;
		readonly targetId: string;
	};
};

/** The epoch is scoped to one device. Sequence orders receipt, not native clocks. */
export type LogCursor = {
	readonly epoch: string;
	readonly sequence: number;
};

export type LogRecord = {
	readonly id: string;
	readonly cursor: LogCursor;
	readonly device: string;
	readonly platform: "ios" | "android";
	readonly source: LogSource;
	readonly receivedAt: number;
	readonly sourceTime?: { readonly text: string; readonly epochMs?: number };
	readonly level: LogLevel;
	readonly nativeLevel?: string;
	readonly message: string;
	readonly app?: string;
	readonly projectId?: string;
	readonly pid?: number;
	readonly tid?: number;
	readonly tag?: string;
	readonly process?: string;
	readonly stack?: string;
	readonly truncated: boolean;
};

export type LogRecordInput = Omit<
	LogRecord,
	"id" | "cursor" | "receivedAt" | "truncated"
> & {
	readonly receivedAt?: number;
	readonly truncated?: boolean;
};

export type LogSourceStatus = {
	readonly device: string;
	readonly source: LogSource;
	readonly state:
		| "connecting"
		| "live"
		| "waiting"
		| "reconnecting"
		| "unavailable"
		| "debugger-conflict"
		| "closed";
	readonly app?: string;
	readonly pid?: number;
	readonly process?: string;
	readonly projectId?: string;
	readonly targetId?: string;
	readonly reason?: string;
};

export type LogGap = {
	readonly reason: "retention" | "reset" | "reconnect";
	readonly requested: LogCursor;
	readonly oldest?: LogCursor;
	/** Null means the collector cannot measure the number of missing records. */
	readonly dropped: number | null;
};

export type LogRead = {
	readonly records: readonly LogRecord[];
	/** ApplicationLogs reports the selected collector's statuses, filtered only by device and source. */
	readonly statuses: readonly LogSourceStatus[];
	readonly cursor: LogCursor;
	/** Known lost records. Use gap.dropped to distinguish unknown loss. */
	readonly dropped: number;
	readonly gap?: LogGap;
	readonly hasMore: boolean;
};

export type LogEvent =
	| {
			readonly type: "records";
			readonly records: readonly LogRecord[];
			readonly cursor: LogCursor;
			readonly dropped: number;
			readonly gap?: LogGap;
	  }
	| { readonly type: "status"; readonly status: LogSourceStatus }
	| {
			readonly type: "reset";
			readonly cursor: LogCursor;
			readonly reason: "restart" | "retention" | "reconnect";
	  };

export type LogQuery = {
	readonly device: string;
	readonly after?: LogCursor;
	readonly limit: number;
	readonly query?: string;
	/** Minimum severity. */
	readonly level?: LogLevel;
	readonly sources?: readonly LogSource[];
	readonly app?: string;
	readonly pid?: number;
	readonly process?: string;
};

/** Display grouping never replaces the immutable occurrence records. */
export type LogGroup = {
	readonly first: LogRecord;
	readonly last: LogRecord;
	readonly count: number;
	readonly occurrences: readonly LogRecord[];
};
