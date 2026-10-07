import { InvalidCommandInput } from "../errors";
import {
	LOG_LEVELS,
	LOG_LIMITS,
	LOG_SOURCES,
	type LogCursor,
	type LogRecord,
	type LogRecordInput,
	type LogSourceStatus,
} from "./contracts";
import { formatLogCursor, logCursorDevice, logDevice } from "./query";

function invalid(message: string): never {
	throw new InvalidCommandInput({ message });
}

function boundedText(
	value: string,
	characters: number,
	bytes = Infinity,
): { value: string; truncated: boolean } {
	if (typeof value !== "string") invalid("Log text must be a string");
	let end = 0;
	let count = 0;
	let size = 0;
	for (const character of value) {
		const point = character.codePointAt(0)!;
		const length =
			point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
		if (count === characters || size + length > bytes) break;
		end += character.length;
		count += 1;
		size += length;
	}
	return { value: value.slice(0, end), truncated: end < value.length };
}

function finite(value: number, field: string): number {
	if (!Number.isFinite(value) || value < 0)
		invalid(`Log ${field} must be a nonnegative finite number`);
	return value;
}

function pid(
	value: number | undefined,
	field: string,
	minimum = 1,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isInteger(value) || value < minimum || value > 2_147_483_647)
		invalid(`Invalid log ${field}`);
	return value;
}

export function normalizeLogRecord(
	input: LogRecordInput,
	cursor: LogCursor,
	now: number,
): LogRecord {
	const device = logDevice(input.device);
	if (logCursorDevice(cursor.epoch) !== device)
		invalid("Log cursor belongs to another device");
	if (typeof input.message !== "string")
		invalid("Log message must be a string");
	if (input.platform !== "ios" && input.platform !== "android")
		invalid("Invalid log platform");
	if (!LOG_SOURCES.includes(input.source)) invalid("Invalid log source");
	if (!LOG_LEVELS.includes(input.level)) invalid("Invalid log level");
	if (
		(input.source === "ios-native" && input.platform !== "ios") ||
		(input.source === "android-native" && input.platform !== "android")
	)
		invalid("Log source does not match its platform");
	let truncated = input.truncated === true;
	const bound = (
		value: string | undefined,
		characters = 512,
		bytes = Infinity,
	) => {
		if (value === undefined) return undefined;
		const result = boundedText(value, characters, bytes);
		truncated ||= result.truncated;
		return result.value;
	};
	const message = bound(input.message, LOG_LIMITS.messageCharacters)!;
	const stack = bound(input.stack, Infinity, LOG_LIMITS.stackBytes);
	const sourceTime =
		input.sourceTime === undefined
			? undefined
			: Object.freeze({
					text: bound(input.sourceTime.text)!,
					epochMs:
						input.sourceTime.epochMs === undefined
							? undefined
							: finite(input.sourceTime.epochMs, "source timestamp"),
				});
	const fields = {
		id: formatLogCursor(cursor),
		cursor: Object.freeze({ ...cursor }),
		device,
		platform: input.platform,
		source: input.source,
		receivedAt: finite(input.receivedAt ?? now, "receive time"),
		sourceTime,
		level: input.level,
		nativeLevel: bound(input.nativeLevel, 64),
		message,
		app: bound(input.app),
		projectId: bound(input.projectId),
		pid: pid(input.pid, "PID"),
		tid: pid(input.tid, "thread ID", 0),
		tag: bound(input.tag),
		process: bound(input.process),
		stack,
	};
	return Object.freeze({ ...fields, truncated });
}

export function normalizeLogStatus(input: LogSourceStatus): LogSourceStatus {
	const device = logDevice(input.device);
	if (!LOG_SOURCES.includes(input.source)) invalid("Invalid log source");
	if (
		![
			"connecting",
			"live",
			"waiting",
			"reconnecting",
			"unavailable",
			"debugger-conflict",
			"closed",
		].includes(input.state)
	)
		invalid("Invalid log source state");
	const bound = (value: string | undefined) =>
		value === undefined ? undefined : boundedText(value, 512).value;
	return Object.freeze({
		device,
		source: input.source,
		state: input.state,
		app: bound(input.app),
		pid: pid(input.pid, "PID"),
		process: bound(input.process),
		projectId: bound(input.projectId),
		targetId: bound(input.targetId),
		reason: bound(input.reason),
	});
}

const encoder = new TextEncoder();

/** Charge UTF-8 JSON bytes and a fixed entry allowance. Never charge UTF-16 length. */
export function logRecordBytes(record: LogRecord): number {
	return encoder.encode(JSON.stringify(record)).byteLength + 64;
}
