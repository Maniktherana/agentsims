import type { AndroidLogLine } from "../core/android/contracts";
import type {
	LogEvent,
	LogRead,
	LogRecord,
	LogSourceStatus,
} from "../core/tools/logs/contracts";
import { formatLogCursor } from "../core/tools/logs/query";

export function renderDeviceLogs(payload: unknown): string {
	const lines = Array.isArray((payload as { lines?: unknown[] })?.lines)
		? ((payload as { lines: AndroidLogLine[] }).lines ?? [])
		: [];
	if (lines.length === 0) return "No device logs.";
	return lines
		.map((line) => `${line.time} ${line.level} ${line.tag} ${line.message}`)
		.join("\n");
}

function applicationRecord(record: LogRecord): string {
	const received = new Date(record.receivedAt);
	const time =
		record.sourceTime?.text ??
		(Number.isFinite(received.getTime())
			? received.toISOString()
			: String(record.receivedAt));
	const metadata = [
		record.app,
		record.pid === undefined ? undefined : `pid=${record.pid}`,
		record.tag,
	]
		.filter(Boolean)
		.join(" ");
	const stack = record.stack ? `\n${record.stack}` : "";
	return `${time} ${record.level.toUpperCase()} [${record.source}]${metadata ? ` ${metadata}` : ""} ${record.message}${record.truncated ? " [truncated]" : ""}${stack}`;
}
function applicationStatus(status: LogSourceStatus): string {
	return `[${status.source}] ${status.state}${status.app ? ` ${status.app}` : ""}${status.reason ? `: ${status.reason}` : ""}`;
}
function applicationGap(gap: NonNullable<LogRead["gap"]>): string {
	return `Log gap (${gap.reason}): ${gap.dropped === null ? "lost count unknown" : `${gap.dropped} records lost`}.`;
}

export function renderAppLogs(read: LogRead): string {
	return [
		...(read.gap ? [applicationGap(read.gap)] : []),
		...read.statuses.map(applicationStatus),
		...(read.records.length
			? read.records.map(applicationRecord)
			: ["No application logs."]),
		`cursor ${formatLogCursor(read.cursor)}`,
	].join("\n");
}

export function renderAppLogEvent(event: LogEvent): string {
	if (event.type === "status") return applicationStatus(event.status);
	if (event.type === "reset")
		return `Logs reset (${event.reason}). cursor ${formatLogCursor(event.cursor)}`;
	return [
		...(event.gap ? [applicationGap(event.gap)] : []),
		...event.records.map(applicationRecord),
	].join("\n");
}
