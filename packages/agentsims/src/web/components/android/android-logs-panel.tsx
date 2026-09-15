import { NumberMorph } from "../ui/number-morph";
import { TextMorph } from "torph/react";
import { appendAndroidLogLines } from "../../android/log-buffer";
import { useEffect, useRef, useState } from "react";
import type {
	AndroidLogEvent,
	AndroidLogLine,
} from "../../../core/android/contracts";
import {
	androidToolsUrl,
	downloadAndroidText,
} from "../../android/tools-client";
import { Select } from "../ui/select";

const rowHeight = 22;

export function AndroidLogsPanel({
	deviceId,
	basePath,
}: {
	deviceId: string;
	basePath: string;
}) {
	const [rows, setRows] = useState<AndroidLogLine[]>([]);
	const [status, setStatus] = useState("Connecting");
	const [paused, setPaused] = useState(false);
	const [follow, setFollow] = useState(true);
	const [filter, setFilter] = useState({
		level: "V",
		package: "",
		query: "",
		pid: "",
	});
	const [applied, setApplied] = useState(filter);
	const [scrollTop, setScrollTop] = useState(0);
	const [height, setHeight] = useState(400);
	const pending = useRef<AndroidLogLine[]>([]);
	const viewport = useRef<HTMLDivElement>(null);
	const pausedRef = useRef(paused);
	pausedRef.current = paused;
	useEffect(() => {
		pending.current = [];
		setRows([]);
		setStatus("Connecting");
		const query = new URLSearchParams();
		for (const [key, value] of Object.entries(applied))
			if (value) query.set(key, value);
		const source = new EventSource(
			`${androidToolsUrl(basePath, deviceId, "logs")}&${query}`,
		);
		source.onmessage = (message) => {
			const event = JSON.parse(message.data) as AndroidLogEvent;
			if (event.type === "lines") {
				pending.current = appendAndroidLogLines(pending.current, event.lines);
				setStatus("Connected");
			} else
				setStatus(
					event.state === "connected"
						? "Connected"
						: (event.message ?? "Reconnecting").replace(/…|\.{3}/g, ""),
				);
		};
		source.onerror = () => setStatus("Connection lost. Reconnecting");
		source.addEventListener("failure", (event) => {
			setStatus(JSON.parse((event as MessageEvent).data).error);
			source.close();
		});
		// Batch updates independently of video paint. The list never grows with log volume.
		const timer = setInterval(() => {
			if (!pausedRef.current) setRows(pending.current);
		}, 200);
		return () => {
			clearInterval(timer);
			source.close();
		};
	}, [deviceId, basePath, applied]);
	useEffect(() => {
		const element = viewport.current;
		if (!element) return;
		const observer = new ResizeObserver(() => setHeight(element.clientHeight));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (follow && !paused && viewport.current)
			viewport.current.scrollTop = viewport.current.scrollHeight;
	}, [rows, follow, paused]);
	const first = Math.max(
		0,
		Math.min(rows.length - 1, Math.floor(scrollTop / rowHeight) - 8),
	);
	const visible = rows.slice(first, first + Math.ceil(height / rowHeight) + 16);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
			<details className="shrink-0">
				<summary className="cursor-pointer py-1">Log filters</summary>
				<form
					className="flex flex-wrap items-end gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						setApplied({ ...filter });
					}}
				>
					<label className="flex min-w-24 flex-1 flex-col gap-1">
						App package
						<input
							className="min-w-0 rounded border border-current/15 bg-transparent px-2 py-1.5"
							placeholder="All apps"
							value={filter.package}
							onChange={(event) =>
								setFilter({ ...filter, package: event.target.value })
							}
						/>
					</label>
					<label className="flex min-w-28 flex-1 flex-col gap-1">
						Search
						<input
							className="min-w-0 rounded border border-current/15 bg-transparent px-2 py-1.5"
							value={filter.query}
							onChange={(event) =>
								setFilter({ ...filter, query: event.target.value })
							}
						/>
					</label>
					<label className="flex flex-col gap-1">
						Level
						<Select
							label="Log level"
							className="h-8 min-w-0 rounded border border-current/15 bg-transparent px-2"
							value={filter.level}
							onChange={(level) => setFilter({ ...filter, level })}
							options={[
								{ value: "V", label: "Verbose" },
								{ value: "D", label: "Debug" },
								{ value: "I", label: "Info" },
								{ value: "W", label: "Warning" },
								{ value: "E", label: "Error" },
								{ value: "F", label: "Fatal" },
							]}
						/>
					</label>
					<label className="flex w-20 flex-col gap-1">
						PID
						<input
							type="number"
							min="1"
							className="min-w-0 rounded border border-current/15 bg-transparent px-2 py-1.5"
							value={filter.pid}
							onChange={(event) =>
								setFilter({ ...filter, pid: event.target.value })
							}
						/>
					</label>
					<button className="rounded bg-current/10 px-2 py-1.5" type="submit">
						Apply
					</button>
				</form>
			</details>
			<div className="flex shrink-0 flex-wrap items-center gap-3">
				<button
					type="button"
					aria-pressed={paused}
					onClick={() => setPaused(!paused)}
				>
					{paused ? "Resume" : "Pause"}
				</button>
				<button
					onClick={() => {
						pending.current = [];
						setRows([]);
					}}
				>
					Clear view
				</button>
				<button
					onClick={() =>
						downloadAndroidText(
							`${deviceId.replace(/[^a-z0-9-]/gi, "-")}-logcat.txt`,
							rows
								.map(
									(row) =>
										`${row.time} ${row.pid} ${row.level} ${row.tag}: ${row.message}`,
								)
								.join("\n"),
						)
					}
				>
					Export
				</button>
				<label className="flex items-center gap-1.5">
					<input
						type="checkbox"
						checked={follow}
						onChange={(event) => setFollow(event.target.checked)}
					/>
					Follow
				</label>
				<span className="ms-auto min-w-0 break-words opacity-60" role="status">
					<TextMorph>{status}</TextMorph> ·{" "}
					<NumberMorph>{rows.length}</NumberMorph> lines
				</span>
			</div>
			<div
				ref={viewport}
				className="relative min-h-32 flex-1 overflow-auto rounded border border-current/10 font-mono"
				onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
				role="log"
				aria-label={`Android device logs for ${deviceId}`}
				tabIndex={0}
				aria-live="off"
			>
				<div style={{ height: rows.length * rowHeight, minWidth: "100%" }}>
					<div style={{ transform: `translateY(${first * rowHeight}px)` }}>
						{visible.map((row) => (
							<div
								key={row.id}
								style={{ height: rowHeight, lineHeight: `${rowHeight}px` }}
								className={`whitespace-pre px-2 ${row.level === "E" || row.level === "F" ? "text-red-500" : row.level === "W" ? "text-amber-600" : ""}`}
								title={row.message}
							>
								{row.time} {row.pid} {row.level} {row.tag}: {row.message}
							</div>
						))}
					</div>
				</div>
				{rows.length === 0 && (
					<p className="p-3 opacity-60">No log lines match these filters.</p>
				)}
			</div>
			<p className="shrink-0 opacity-50">
				Shows the latest 2,000 lines. Clear view does not erase the Android log
				buffer.
			</p>
		</div>
	);
}
