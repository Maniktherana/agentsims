import type {
	AndroidLogFilter,
	AndroidLogLevel,
	AndroidLogLine,
} from "../contracts";

export const ANDROID_LOG_LIMIT = 2000;
export const ANDROID_LOG_BYTE_LIMIT = 1024 * 1024;
export function parseAndroidLogLine(
	raw: string,
	id: number,
): AndroidLogLine | null {
	const match =
		/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^:]*):\s?(.*)$/.exec(
			raw,
		);
	if (!match) return null;
	return {
		id,
		time: match[1]!,
		pid: Number(match[2]),
		tid: Number(match[3]),
		level: match[4] as AndroidLogLevel,
		tag: match[5]!.trim(),
		message: match[6]!.slice(0, 4096),
	};
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
