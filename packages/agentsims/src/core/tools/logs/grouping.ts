import type { LogGroup, LogRecord } from "./contracts";

function identity(record: LogRecord): string {
	return JSON.stringify([
		record.device,
		record.platform,
		record.source,
		record.cursor.epoch,
		record.level,
		record.nativeLevel,
		record.message,
		record.app,
		record.projectId,
		record.pid,
		record.tid,
		record.tag,
		record.process,
		record.stack,
		record.truncated,
	]);
}

/** Group adjacent complete messages only. Truncated text cannot prove a repeat. */
export function groupLogRecords(
	records: readonly LogRecord[],
): readonly LogGroup[] {
	const groups: LogRecord[][] = [];
	let previous: string | undefined;
	for (const record of records) {
		const key = record.truncated ? undefined : identity(record);
		const last = groups.at(-1);
		if (key !== undefined && key === previous && last) last.push(record);
		else groups.push([record]);
		previous = key;
	}
	return Object.freeze(
		groups.map((occurrences) =>
			Object.freeze({
				first: occurrences[0]!,
				last: occurrences.at(-1)!,
				count: occurrences.length,
				occurrences: Object.freeze(occurrences),
			}),
		),
	);
}
