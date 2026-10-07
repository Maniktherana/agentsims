import type { LogRecord } from "../../core/tools/logs/contracts";
import type { ConsoleSession } from "./state";

export const CONSOLE_ROW_HEIGHT = 24;
export type ConsoleRow = { record: LogRecord; top: number; height: number };

export function consoleRows(records: readonly LogRecord[], wrap: boolean, width: number,
	measured: ReadonlyMap<string, number>): readonly ConsoleRow[] {
	let top = 0;
	const columns = Math.max(12, Math.floor((width - 300) / 7.2));
	return records.map(record => {
		const text = record.stack ? `${record.message}\n${record.stack}` : record.message;
		const lines = text.split(/\r\n|\r|\n/).reduce((sum, line) => sum + (wrap ? Math.max(1, Math.ceil(line.length / columns)) : 1), 0);
		const height = measured.get(record.id) ?? Math.max(CONSOLE_ROW_HEIGHT, lines * 18 + 6);
		const row = { record, top, height };
		top += height;
		return row;
	});
}

export function visibleConsoleRows(rows: readonly ConsoleRow[], scrollTop: number, height: number): readonly ConsoleRow[] {
	const start = Math.max(0, scrollTop - 192);
	const end = scrollTop + height + 192;
	let low = 0;
	let high = rows.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (rows[middle]!.top + rows[middle]!.height < start) low = middle + 1;
		else high = middle;
	}
	const first = low;
	high = rows.length;
	while (low < high) {
		const middle = (low + high) >>> 1;
		if (rows[middle]!.top <= end) low = middle + 1;
		else high = middle;
	}
	return rows.slice(first, low);
}

export function consoleScrollAnchor(rows: readonly ConsoleRow[], scrollTop: number): { id: string; offset: number } | undefined {
	const row = rows.find(row => row.top + row.height > scrollTop);
	return row ? { id: row.record.id, offset: scrollTop - row.top } : undefined;
}

export type ConsoleScrollViewport = { scrollTop: number; readonly scrollHeight: number; readonly clientHeight: number };

export function consoleCanJump(viewport: ConsoleScrollViewport): boolean {
	return viewport.clientHeight > 0 && viewport.scrollHeight > viewport.clientHeight &&
		viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 24;
}

/** Save the actual bottom before follow changes, including when display is paused. */
export function jumpConsoleToLatest(viewport: ConsoleScrollViewport, session: ConsoleSession,
	rows: readonly ConsoleRow[], setFollow: (follow: boolean) => void): void {
	viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
	session.scrollTop = viewport.scrollTop;
	session.anchor = consoleScrollAnchor(rows, viewport.scrollTop);
	setFollow(true);
}

/** A single click selects one occurrence; modifier keys extend the immutable selection. */
export function consoleSelection(records: readonly LogRecord[], selected: readonly LogRecord[], record: LogRecord,
	options: { additive: boolean; range: boolean }): readonly LogRecord[] {
	if (options.range && selected.length) {
		const anchor = records.findIndex(item => item.id === selected[selected.length - 1]!.id);
		const end = records.findIndex(item => item.id === record.id);
		if (anchor >= 0 && end >= 0) return records.slice(Math.min(anchor, end), Math.max(anchor, end) + 1);
	}
	if (!options.additive) return [record];
	return selected.some(item => item.id === record.id) ? selected.filter(item => item.id !== record.id) : [...selected, record];
}
