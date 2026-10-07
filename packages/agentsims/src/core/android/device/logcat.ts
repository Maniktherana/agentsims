import type {
	AndroidLogFilter,
	AndroidLogLevel,
	AndroidLogLine,
} from "../contracts";
import { Stream } from "effect";
import type { LogLevel, LogRecordInput } from "../../tools/logs/contracts";

export const ANDROID_LOG_LIMIT = 2000;
export const ANDROID_LOG_BYTE_LIMIT = 1024 * 1024;
const ANDROID_LOG_LINE_CHARACTERS = 64 * 1024;
const metadata = new WeakMap<
	AndroidLogLine,
	{ readonly receivedAt: number; readonly truncated: boolean }
>();
const levels: Record<AndroidLogLevel, LogLevel> = {
	V: "trace",
	D: "debug",
	I: "info",
	W: "warn",
	E: "error",
	F: "fatal",
};

function boundedLogText(value: string, maximum: number): string {
	if (value.length <= maximum) return value;
	let end = 0;
	let count = 0;
	for (const character of value) {
		if (count++ === maximum) break;
		end += character.length;
	}
	return value.slice(0, end);
}

export function parseAndroidLogLine(
	raw: string,
	id: number,
	receivedAt = Date.now(),
): AndroidLogLine | null {
	if (raw.length > ANDROID_LOG_LINE_CHARACTERS) return null;
	const match =
		/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]*):\s?(.*)$/.exec(
			raw,
		);
	if (!match) return null;
	const original = match[6]!;
	const message = boundedLogText(original, 4096);
	const originalTag = match[5]!.trim();
	const tag = boundedLogText(originalTag, 512);
	const line = Object.freeze({
		id,
		time: match[1]!,
		pid: Number(match[2]),
		tid: Number(match[3]),
		level: match[4] as AndroidLogLevel,
		tag,
		message,
	});
	metadata.set(line, {
		receivedAt,
		truncated:
			message.length < original.length || tag.length < originalTag.length,
	});
	return line;
}

/** Keep the original capture time when a legacy buffer is replayed to an app reader. */
export function androidLogRecord(
	line: AndroidLogLine,
	context: {
		readonly device: string;
		readonly app?: string;
		readonly process?: string;
	},
	receivedAt = Date.now(),
): LogRecordInput {
	const captured = metadata.get(line);
	return Object.freeze({
		device: context.device,
		platform: "android",
		source: "android-native",
		receivedAt: captured?.receivedAt ?? receivedAt,
		sourceTime: Object.freeze({ text: line.time }),
		level: levels[line.level],
		nativeLevel: line.level,
		message: line.message,
		app: context.app,
		pid: line.pid ?? undefined,
		tid: line.tid ?? undefined,
		tag: line.tag,
		process: context.process,
		truncated: captured?.truncated ?? false,
	});
}

/** Bound incomplete host output and recover after a malformed oversized line. */
export function androidLogLines<E, R>(
	input: Stream.Stream<Uint8Array, E, R>,
): Stream.Stream<string, E, R> {
	return Stream.suspend(() => {
		let pending = "";
		let discarding = false;
		return input.pipe(
			Stream.decodeText(),
			Stream.mapConcat((chunk) => {
				const lines: string[] = [];
				let start = 0;
				while (start < chunk.length) {
					const newline = chunk.indexOf("\n", start);
					const end = newline < 0 ? chunk.length : newline;
					if (!discarding) {
						if (pending.length + end - start > ANDROID_LOG_LINE_CHARACTERS) {
							pending = "";
							discarding = true;
						} else pending += chunk.slice(start, end);
					}
					if (newline < 0) break;
					if (!discarding)
						lines.push(pending.endsWith("\r") ? pending.slice(0, -1) : pending);
					pending = "";
					discarding = false;
					start = newline + 1;
				}
				return lines;
			}),
			Stream.concat(
				Stream.suspend(() =>
					discarding || pending.length === 0
						? Stream.empty
						: Stream.succeed(pending),
				),
			),
		);
	});
}
export function androidLogMatches(
	line: AndroidLogLine,
	filter: AndroidLogFilter,
	packagePids?: ReadonlySet<number>,
): boolean {
	if (
		filter.level &&
		"VDIWEF".indexOf(line.level) < "VDIWEF".indexOf(filter.level)
	)
		return false;
	if (filter.pid !== undefined && line.pid !== filter.pid) return false;
	if (filter.package && (!packagePids || !packagePids.has(line.pid ?? -1)))
		return false;
	return (
		!filter.query ||
		`${line.tag} ${line.message}`
			.toLowerCase()
			.includes(filter.query.toLowerCase())
	);
}
export class AndroidLogBuffer {
	private entries: AndroidLogLine[] = [];
	private bytes = 4;
	private total = 0;
	push(lines: readonly AndroidLogLine[]): void {
		this.total += lines.length;
		for (const line of lines) {
			this.entries.push(line);
			this.bytes += JSON.stringify(line).length * 2 + 2;
		}
		while (
			this.entries.length > ANDROID_LOG_LIMIT ||
			this.bytes > ANDROID_LOG_BYTE_LIMIT
		) {
			const removed = this.entries.shift();
			if (removed) this.bytes -= JSON.stringify(removed).length * 2 + 2;
		}
	}
	read(): AndroidLogLine[] {
		return [...this.entries];
	}
	count(): number {
		return this.total;
	}
}
