import { expect, test } from "bun:test";
import type { LogRecord } from "../../../../core/tools/logs/contracts";
import { consoleKindSources, consoleSetKind } from "../../../../web/console/kinds";
import { ConsoleStore, visibleRecords } from "../../../../web/console/state";

test("Native maps to the chosen phone and both platforms in All, with independent filters", () => {
	const store = new ConsoleStore();
	store.retainDevices(["ios-1", "android-1"]);
	for (const [device, platform, source] of [["ios-1", "ios", "ios-native"], ["android-1", "android", "android-native"]] as const) {
		const cursor = { epoch: `${device}~00000000-0000-0000-0000-000000000001`, sequence: 1 };
		const native: LogRecord = { id: `${device}:native`, device, platform, source, cursor, receivedAt: 1, level: "info", message: device, truncated: false };
		store.event(device, { type: "records", records: [native], cursor, dropped: 0 });
	}
	store.synchronizeAggregate();
	store.filters(null, { sources: consoleSetKind(["react-native"], "native", "ios", "all", true) });
	expect(visibleRecords(store.aggregate()).map(record => record.device)).toEqual(["android-1", "ios-1"]);
	store.filters("ios-1", { sources: consoleSetKind([], "native", "ios", "device", true) });
	store.filters("android-1", { sources: consoleSetKind([], "native", "android", "device", true) });
	expect(store.session("ios-1").filters.sources).toEqual(["ios-native"]);
	expect(store.session("android-1").filters.sources).toEqual(["android-native"]);
	store.filters(null, { sources: consoleSetKind(store.aggregate().filters.sources, "native", "android", "all", false) });
	expect(visibleRecords(store.aggregate())).toHaveLength(0);
	expect(store.aggregate().filters.sources).toEqual(["react-native"]);
	expect(visibleRecords(store.session("ios-1"))).toHaveLength(1);
	expect(visibleRecords(store.session("android-1"))).toHaveLength(1);
	expect(consoleKindSources("react-native", "ios", "all")).toEqual(["react-native"]);
});
