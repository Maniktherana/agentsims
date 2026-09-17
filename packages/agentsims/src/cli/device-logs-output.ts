import type { AndroidLogLine } from "../core/android/contracts";

export function renderDeviceLogs(payload: unknown): string {
	const lines = Array.isArray((payload as { lines?: unknown[] })?.lines)
		? ((payload as { lines: AndroidLogLine[] }).lines ?? [])
		: [];
	if (lines.length === 0) return "No device logs.";
	return lines
		.map((line) => `${line.time} ${line.level} ${line.tag} ${line.message}`)
		.join("\n");
}
