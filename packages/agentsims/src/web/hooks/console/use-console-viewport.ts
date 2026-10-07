import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LogRecord } from "../../../core/tools/logs/contracts";
import { consoleCanJump, consoleRows, consoleScrollAnchor, jumpConsoleToLatest, visibleConsoleRows } from "../../console/rows";
import { scrollPosition, type ConsoleSession } from "../../console/state";

export function useConsoleViewport(records: readonly LogRecord[], session: ConsoleSession,
	setFollow: (follow: boolean) => void) {
	const viewport = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState({ width: 800, height: 240 });
	const [scrollTop, setScrollTop] = useState(session.scrollTop);
	const [measured, setMeasured] = useState<ReadonlyMap<string, number>>(new Map());
	const [canJump, setCanJump] = useState(false);
	const requestedScroll = useRef(session.scrollTop);
	const rows = useMemo(() => consoleRows(records, session.options.wrap, size.width, measured),
		[records, session.options.wrap, size.width, measured]);
	const shown = visibleConsoleRows(rows, scrollTop, size.height);
	const last = rows[rows.length - 1];
	const height = last ? last.top + last.height : 0;

	useEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const update = () => {
			setCanJump(consoleCanJump(element));
			if (!element.clientWidth || !element.clientHeight) return;
			setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight
				? previous : { width: element.clientWidth, height: element.clientHeight });
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => { setMeasured(new Map()); }, [size.width, session.options.wrap]);
	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element || !element.clientHeight) return;
		const next = scrollPosition({ ...session.options, scrollTop: session.scrollTop,
			scrollHeight: element.scrollHeight, viewportHeight: element.clientHeight, anchor: session.anchor,
			rows: rows.map(row => ({ id: row.record.id, top: row.top })) });
		element.scrollTop = next;
		requestedScroll.current = element.scrollTop;
		session.scrollTop = element.scrollTop;
		session.anchor = consoleScrollAnchor(rows, element.scrollTop);
		setScrollTop(element.scrollTop);
		setCanJump(consoleCanJump(element));
	}, [rows, height, size.height, session, session.options.follow, session.options.paused]);
	useLayoutEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const observer = new ResizeObserver(entries => {
			setMeasured(previous => {
				const ids = new Set(records.map(record => record.id));
				const next = new Map([...previous].filter(([id]) => ids.has(id)));
				let changed = next.size !== previous.size;
				for (const entry of entries) {
					const id = (entry.target as HTMLElement).dataset.logId;
					const height = Math.ceil(entry.target.getBoundingClientRect().height);
					if (id && ids.has(id) && height > 0 && next.get(id) !== height) { next.set(id, height); changed = true; }
				}
				return changed ? next : previous;
			});
		});
		for (const row of element.querySelectorAll("[data-log-id]")) observer.observe(row);
		return () => observer.disconnect();
	}, [records, shown[0]?.record.id, shown[shown.length - 1]?.record.id, session.options.wrap]);

	return { viewport, rows, shown, height, canJump,
		jumpToLatest() {
			const element = viewport.current;
			if (!element) return;
			jumpConsoleToLatest(element, session, rows, follow => {
				requestedScroll.current = element.scrollTop;
				setFollow(follow);
			});
			setScrollTop(element.scrollTop);
			setCanJump(consoleCanJump(element));
		},
		onScroll() {
			const element = viewport.current;
			if (!element) return;
			if (session.options.follow && Math.abs(element.scrollTop - requestedScroll.current) > 1 &&
				consoleCanJump(element)) setFollow(false);
			session.scrollTop = element.scrollTop;
			session.anchor = consoleScrollAnchor(rows, element.scrollTop);
			setScrollTop(element.scrollTop);
			setCanJump(consoleCanJump(element));
		},
		onWheel(deltaY: number) { if (deltaY < 0 && session.options.follow) setFollow(false); },
	};
}
