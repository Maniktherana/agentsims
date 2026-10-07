import { expect, test } from "bun:test";
import type { LogGap, LogSourceStatus } from "../../../../core/tools/logs/contracts";
import { consoleEmptyMessage, consoleHistoryNote, consoleSourceNotices } from "../../../../web/console/availability";
import { ConsoleStore } from "../../../../web/console/state";
import retainedHistory from "../../../fixtures/console/android-retained-history.json";
import emptyReconnect from "../../../fixtures/console/android-empty-reconnect.json";
import { parseLogRead } from "../../../../web/console/client";

const statuses: readonly LogSourceStatus[] = [
	{ device: "android-1", source: "android-native", state: "live" },
	{ device: "ios-1", source: "ios-native", state: "live" },
	{ device: "android-1", source: "react-native", state: "unavailable", reason: "Select a React Native project, Metro URL, and inspector target" },
	{ device: "ios-1", source: "react-native", state: "unavailable", reason: "Select a React Native project, Metro URL, and inspector target" },
];

test("names two unconnected RN targets once without treating live native sources as unavailable", () => {
	const notices = consoleSourceNotices(statuses, ["android-native", "ios-native", "react-native"]);
	expect(notices).toHaveLength(1);
	expect(notices[0]).toMatchObject({ source: "react-native", state: "unavailable", label: "React Native not connected" });
	expect(notices[0]!.statuses).toEqual(statuses.slice(2));
	expect(notices[0]!.statuses[0]).toBe(statuses[2]);
});

test("disabled sources and no selected sources do not raise availability notices", () => {
	expect(consoleSourceNotices(statuses, ["ios-native", "android-native"])).toEqual([]);
	expect(consoleSourceNotices(statuses, [])).toEqual([]);
});

test("native failures and debugger conflicts keep source identity and original device reasons", () => {
	const failures: readonly LogSourceStatus[] = [
		{ device: "ios-1", source: "ios-native", state: "unavailable", reason: "Native process exited" },
		{ device: "android-1", source: "android-native", state: "closed", reason: "Device disconnected" },
		{ device: "ios-1", source: "react-native", state: "debugger-conflict", reason: "Another debugger is attached" },
	];
	const notices = consoleSourceNotices(failures, ["ios-native", "android-native", "react-native"]);
	expect(notices.map(notice => notice.label)).toEqual(["iOS unavailable", "Android closed", "React Native debugger conflict"]);
	expect(notices.flatMap(notice => notice.statuses)).toEqual([...failures]);
});

test("empty state distinguishes disabled types, app waiting, pause, and actual filter matches", () => {
	const store = new ConsoleStore();
	const device = retainedHistory.records[0]!.device;
	const session = store.session(device);
	store.connection(device, "live");
	expect(consoleEmptyMessage(session, [])).toStartWith("No log types selected.");
	expect(consoleEmptyMessage(session, ["android-native"])).toStartWith("Waiting for logs from the app in front.");
	store.options(device, { paused: true });
	expect(consoleEmptyMessage(session, ["android-native"])).toStartWith("Display is paused.");
	store.options(device, { paused: false });
	store.read(device, parseLogRead(retainedHistory, device));
	store.filters(device, { query: "no matching message" });
	expect(consoleEmptyMessage(session, ["android-native"])).toBe("No logs match your filters.");
	store.filters(device, { appMode: "fixed", fixedApp: "" });
	expect(consoleEmptyMessage(session, ["android-native"])).toStartWith("Enter an application ID");
});

test("history notes distinguish unknown reconnect loss from a real restart and known missing records", () => {
	const gap = emptyReconnect.gap as LogGap;
	expect(consoleHistoryNote(gap, false)).toEqual({ label: "Logs reconnected",
		description: "The log connection changed. Saved logs are kept. The source cannot confirm whether logs were missed." });
	expect(consoleHistoryNote({ ...gap, reason: "retention", dropped: 12 }, false)?.description).toContain("12 logs are missing");
	expect(consoleHistoryNote({ ...gap, reason: "reset" }, false)?.label).toBe("Log history restarted");
	expect(consoleHistoryNote(undefined, true)?.label).toBe("Recent history only");
	expect(consoleHistoryNote(undefined, false)).toBeNull();
});
