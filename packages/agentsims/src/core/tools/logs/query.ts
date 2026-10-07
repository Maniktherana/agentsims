import { InvalidCommandInput } from "../errors";
import {
	LOG_LEVELS,
	LOG_LIMITS,
	LOG_SOURCES,
	type LogCursor,
	type LogQuery,
	type LogRecord,
	type LogSource,
	type LogSourceStatus,
} from "./contracts";

function invalid(message: string): never {
	throw new InvalidCommandInput({ message });
}

export function logDevice(value: unknown): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.length > 256 ||
		value.trim() !== value ||
		[...value].some(
			(character) =>
				character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
		)
	)
		invalid(
			"Log device must be a nonempty device ID of at most 256 characters",
		);
	try {
		encodeURIComponent(value);
	} catch {
		invalid("Invalid log device ID");
	}
	return value;
}

function text(
	value: unknown,
	field: string,
	maximum = 512,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length > maximum)
		invalid(`Log ${field} must be text of at most ${maximum} characters`);
	return value.length === 0 ? undefined : value;
}

function integer(
	value: unknown,
	field: string,
	minimum: number,
	maximum: number,
): number {
	const number =
		typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	if (
		typeof number !== "number" ||
		!Number.isSafeInteger(number) ||
		number < minimum ||
		number > maximum
	)
		invalid(`Log ${field} must be an integer from ${minimum} to ${maximum}`);
	return number;
}

export function formatLogCursor(cursor: LogCursor): string {
	return `${cursor.epoch}:${cursor.sequence}`;
}

export function logCursorDevice(epoch: string): string {
	const separator = epoch.lastIndexOf("~");
	if (separator < 1 || !/^[0-9a-f-]{36}$/i.test(epoch.slice(separator + 1)))
		invalid("Invalid log cursor epoch");
	try {
		return logDevice(decodeURIComponent(epoch.slice(0, separator)));
	} catch {
		return invalid("Invalid log cursor device");
	}
}

export function parseLogCursor(value: unknown): LogCursor {
	let input = value;
	if (typeof value === "string") {
		const separator = value.lastIndexOf(":");
		if (separator < 1) invalid("Invalid log cursor");
		input = {
			epoch: value.slice(0, separator),
			sequence: value.slice(separator + 1),
		};
	}
	if (typeof input !== "object" || input === null || Array.isArray(input))
		invalid("Invalid log cursor");
	const fields = input as Record<string, unknown>;
	if (typeof fields.epoch !== "string" || fields.epoch.length > 4_096)
		invalid("Invalid log cursor epoch");
	logCursorDevice(fields.epoch);
	return Object.freeze({
		epoch: fields.epoch,
		sequence: integer(
			fields.sequence,
			"cursor sequence",
			0,
			Number.MAX_SAFE_INTEGER,
		),
	});
}

/** All adapters use this parser. Text is a case-insensitive substring; app/process are exact. */
export function parseLogQuery(value: unknown): LogQuery {
	let input = value;
	if (value instanceof URLSearchParams) {
		const fields: Record<string, unknown> = Object.create(null);
		for (const [key, field] of value) {
			if (Object.hasOwn(fields, key))
				invalid(`Duplicate log query field: ${key}`);
			fields[key] = field;
		}
		input = fields;
	}
	if (typeof input !== "object" || input === null || Array.isArray(input))
		invalid("Invalid log query");
	const fields = input as Record<string, unknown>;
	const keys = new Set([
		"device",
		"after",
		"cursor",
		"limit",
		"query",
		"level",
		"sources",
		"source",
		"app",
		"pid",
		"process",
	]);
	for (const key of Object.keys(fields))
		if (!keys.has(key)) invalid(`Unknown log query field: ${key}`);
	if (fields.after !== undefined && fields.cursor !== undefined)
		invalid("Use one log cursor field");
	if (fields.sources !== undefined && fields.source !== undefined)
		invalid("Use one log source field");
	const device = logDevice(fields.device);
	const rawCursor = fields.after === undefined ? fields.cursor : fields.after;
	const after = rawCursor === undefined ? undefined : parseLogCursor(rawCursor);
	if (after && logCursorDevice(after.epoch) !== device)
		invalid("Log cursor belongs to another device");
	const limit = integer(
		fields.limit === undefined ? 100 : fields.limit,
		"limit",
		1,
		LOG_LIMITS.recordsPerDevice,
	);
	const query = text(fields.query, "query", 4_096);
	const level = text(fields.level, "level");
	if (level && !LOG_LEVELS.includes(level as (typeof LOG_LEVELS)[number]))
		invalid("Invalid log level");
	let rawSources =
		fields.sources === undefined ? fields.source : fields.sources;
	if (typeof rawSources === "string") rawSources = rawSources.split(",");
	let sources: readonly LogSource[] | undefined;
	if (rawSources !== undefined) {
		if (
			!Array.isArray(rawSources) ||
			rawSources.length < 1 ||
			rawSources.length > LOG_SOURCES.length
		)
			invalid("Log sources must contain one to three sources");
		if (rawSources.some((source) => !LOG_SOURCES.includes(source)))
			invalid("Invalid log source");
		sources = Object.freeze([...new Set(rawSources as LogSource[])]);
	}
	return Object.freeze({
		device,
		after,
		limit,
		query,
		level: level as LogQuery["level"],
		sources,
		app: text(fields.app, "app"),
		pid:
			fields.pid === undefined
				? undefined
				: integer(fields.pid, "PID", 1, 2_147_483_647),
		process: text(fields.process, "process"),
	});
}

export function logRecordMatches(record: LogRecord, query: LogQuery): boolean {
	if (record.device !== query.device || !logStatusMatches(record, query))
		return false;
	if (
		query.level &&
		LOG_LEVELS.indexOf(record.level) < LOG_LEVELS.indexOf(query.level)
	)
		return false;
	if (query.query) {
		const needle = query.query.toLowerCase();
		if (
			![record.message, record.stack, record.tag, record.process].some(
				(field) => field?.toLowerCase().includes(needle),
			)
		)
			return false;
	}
	return true;
}

export function logStatusMatches(
	status: Pick<
		LogSourceStatus,
		"device" | "source" | "app" | "pid" | "process"
	>,
	query: LogQuery,
): boolean {
	return (
		status.device === query.device &&
		(!query.sources || query.sources.includes(status.source)) &&
		(query.app === undefined || status.app === query.app) &&
		(query.pid === undefined || status.pid === query.pid) &&
		(query.process === undefined || status.process === query.process)
	);
}
