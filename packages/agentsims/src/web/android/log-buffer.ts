import type { AndroidLogLine } from "../../android/contracts";

/** Bound retained log text as well as row count when a panel is paused. */
export function appendAndroidLogLines(
	current: readonly AndroidLogLine[],
	incoming: readonly AndroidLogLine[],
): AndroidLogLine[] {
	const rows = [...current, ...incoming].slice(-2000);
	let bytes = 0;
	let first = rows.length;
	while (first > 0) {
		const row = rows[first - 1]!;
		bytes += (row.message.length + row.tag.length + row.time.length + 64) * 2;
		if (bytes > 1024 * 1024) break;
		first--;
	}
	return rows.slice(first);
}
