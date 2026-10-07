import type { LogGap, LogSource, LogSourceStatus } from "../../core/tools/logs/contracts";
import { sourceLabel, type ConsoleSession } from "./state";

export function consoleSourceNotices(statuses: readonly LogSourceStatus[], enabled: readonly LogSource[]) {
	const groups = new Map<string, { source: LogSource; state: LogSourceStatus["state"]; label: string; statuses: LogSourceStatus[] }>();
	for (const status of statuses) {
		if (!enabled.includes(status.source) || !["unavailable", "debugger-conflict", "closed"].includes(status.state)) continue;
		const key = `${status.source}:${status.state}`;
		let group = groups.get(key);
		if (!group) {
			const state = status.source === "react-native" && status.state === "unavailable" ? "not connected"
				: status.state === "debugger-conflict" ? "debugger conflict" : status.state;
			group = { source: status.source, state: status.state, label: `${sourceLabel(status.source)} ${state}`, statuses: [] };
			groups.set(key, group);
		}
		group.statuses.push(status);
	}
	return [...groups.values()];
}

export function consoleEmptyMessage(session: ConsoleSession, enabled: readonly LogSource[]): string {
	if (!enabled.length) return "No log types selected. Enable Native or React Native to view logs.";
	if (session.filters.appMode === "fixed" && !session.filters.fixedApp) return "Enter an application ID and select Apply.";
	if (session.error) return "Could not read logs. Open source connection details for the reason.";
	if (session.connection === "connecting") return "Connecting to device logs.";
	if ((session.frozen ?? session.records).some(record => enabled.includes(record.source))) return "No logs match your filters.";
	if (session.options.paused) return "Display is paused. Resume to see new logs.";
	const statuses = session.statuses.filter(status => enabled.includes(status.source));
	if (statuses.length && statuses.every(status => ["unavailable", "debugger-conflict", "closed"].includes(status.state)))
		return `${consoleSourceNotices(statuses, enabled).map(notice => notice.label).join(" · ")}. Open source connection details for the reason.`;
	return `Waiting for logs from ${session.filters.appMode === "foreground" ? "the app in front" : "the selected app"}. An idle app may not write logs.`;
}

export function consoleHistoryNote(gap: LogGap | undefined, limited: boolean) {
	if (!gap) return limited ? { label: "Recent history only", description: "Older logs left this browser's history limit." } : null;
	const label = gap.reason === "reset" ? "Log history restarted" : gap.reason === "retention" ? "Older logs unavailable" : "Logs reconnected";
	const change = gap.reason === "reset" ? "The runtime started a new log history."
		: gap.reason === "retention" ? "The runtime expired older log history." : "The log connection changed. Saved logs are kept.";
	const loss = gap.dropped === null ? "The source cannot confirm whether logs were missed."
		: gap.dropped === 0 ? "No missing logs were reported." : `${gap.dropped} logs are missing from the runtime history.`;
	return { label, description: `${change} ${loss}${limited ? " Older logs left this browser's history limit." : ""}` };
}
