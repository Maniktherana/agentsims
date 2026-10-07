import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { LogRecord, LogTarget } from "../../../core/tools/logs/contracts";
import { ConsoleReaders } from "../../console/reader";
import {
	ConsoleStore,
	consoleTarget,
	visibleRecords,
	type ConsoleDevice,
	type ConsoleFilters,
	type ConsoleOptions,
	type ConsoleScope,
} from "../../console/state";

export function useUnifiedLogs(options: {
	selectedDevice: ConsoleDevice | null;
	devices: readonly ConsoleDevice[];
	active: boolean;
	basePath: string;
	scope?: ConsoleScope;
}) {
	const [store] = useState(() => new ConsoleStore());
	const [, refresh] = useReducer((value) => value + 1, 0);
	const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
	const mounted = useRef(false);
	const displaying = useRef(options.active);
	const [visible, setVisible] = useState(
		() =>
			typeof document === "undefined" || document.visibilityState !== "hidden",
	);
	displaying.current = options.active && visible;
	const changed = useCallback(() => {
		if (!mounted.current || !displaying.current || pending.current !== null)
			return;
		// Schedule only after data changes. No animation loop competes with simulator frames.
		pending.current = setTimeout(() => {
			pending.current = null;
			if (mounted.current && displaying.current) {
				store.synchronizeAggregate();
				refresh();
			}
		}, 100);
	}, [store]);
	const [reader] = useState(() => new ConsoleReaders(store, changed));
	const device = options.selectedDevice;
	const all = options.scope === "all";
	const session = all
		? store.aggregate()
		: device
			? store.session(device.id)
			: null;
	// Collection belongs to each phone, independent of which channel is displayed.
	const targetKey = JSON.stringify(
		options.devices
			.map((device) => consoleTarget(device, store.session(device.id).filters))
			.filter((target): target is LogTarget => target !== null),
	);
	const deviceIds = JSON.stringify(options.devices.map((device) => device.id));

	useEffect(() => {
		mounted.current = true;
		const visibility = () => setVisible(document.visibilityState !== "hidden");
		document.addEventListener("visibilitychange", visibility);
		return () => {
			mounted.current = false;
			document.removeEventListener("visibilitychange", visibility);
			if (pending.current !== null) clearTimeout(pending.current);
			pending.current = null;
			void reader.dispose();
		};
	}, [reader]);
	useEffect(() => {
		reader.update({
			targets: JSON.parse(targetKey) as LogTarget[],
			active: visible,
			basePath: options.basePath,
		});
	}, [reader, targetKey, options.basePath, visible]);
	useEffect(() => {
		store.retainDevices(JSON.parse(deviceIds) as string[]);
		refresh();
	}, [store, deviceIds]);
	useEffect(() => {
		if (!options.active || !visible) {
			if (pending.current !== null) clearTimeout(pending.current);
			pending.current = null;
			return;
		}
		store.synchronizeAggregate();
		refresh();
	}, [store, options.active, visible]);

	return {
		session,
		records: session ? visibleRecords(session) : [],
		sourceSessions: (all ? options.devices : device ? [device] : []).map(
			(device) => ({ device, session: store.session(device.id) }),
		),
		historyCount: session ? store.historyCount(all ? null : device!.id) : 0,
		getHistory(): readonly LogRecord[] {
			return session ? store.history(all ? null : device!.id) : [];
		},
		setFilters(change: Partial<ConsoleFilters>) {
			if (!session) return;
			store.filters(all ? null : device!.id, change);
			// An explicit All app change updates each collector. Merely opening All does not.
			if (
				all &&
				(change.appMode !== undefined || change.fixedApp !== undefined)
			) {
				const targetChange = {
					...(change.appMode !== undefined ? { appMode: change.appMode } : {}),
					...(change.fixedApp !== undefined
						? { fixedApp: change.fixedApp }
						: {}),
				};
				for (const device of options.devices)
					store.filters(device.id, targetChange);
			}
			refresh();
		},
		setOptions(change: Partial<ConsoleOptions>) {
			if (session) {
				store.options(all ? null : device!.id, change);
				store.synchronizeAggregate();
				refresh();
			}
		},
		clear() {
			if (session) {
				store.clear(all ? null : device!.id);
				store.synchronizeAggregate();
				refresh();
			}
		},
		select(records: readonly LogRecord[]) {
			if (!session) return false;
			const accepted = store.select(all ? null : device!.id, records);
			if (accepted) refresh();
			return accepted;
		},
	};
}
