import { TextMorph } from "torph/react";
import { openFileCommand } from "../../hooks/simulator/use-screen-recording";
import { execOnHost } from "../../simulator/input/exec";
import { appendAndroidLogLines } from "../../android/log-buffer";
import { useEffect, useRef, useState } from "react";
import type {
	AndroidLogEvent,
	AndroidLogLine,
} from "../../../core/android/contracts";
import {
	androidToolsRequest,
	androidToolsUrl,
	downloadAndroidText,
} from "../../android/tools-client";
import { Button } from "@agentsims/ui/components/button";
import { CompactDisclosure } from "../ui/compact-disclosure";
import { Input } from "@agentsims/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@agentsims/ui/components/select";
import { Switch } from "@agentsims/ui/components/switch";
import { notify } from "../ui/toast";

const rowHeight = 22;

type LogRecording = { path: string; startedAt: string };

export function AndroidLogsPanel({
	deviceId,
	basePath,
	packageName,
}: {
	deviceId: string;
	basePath: string;
	packageName?: string | null;
}) {
	const [rows, setRows] = useState<AndroidLogLine[]>([]);
	const [status, setStatus] = useState("Connecting");
	const [total, setTotal] = useState(0);
	const [paused, setPaused] = useState(false);
	const [follow, setFollow] = useState(true);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const [recording, setRecording] = useState<LogRecording | null>(null);
	const [recordingBusy, setRecordingBusy] = useState(false);
	const [filter, setFilter] = useState({
		level: "D",
		package: packageName ?? "",
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
				setTotal(event.total);
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
		void androidToolsRequest<{ recording: LogRecording | null }>(
			basePath,
			deviceId,
			"logs/recording",
		).then(
			(result) => setRecording(result.recording),
			() => {},
		);
	}, [basePath, deviceId]);
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
	const renderedLogs = rows
		.map(
			(row) => `${row.time} ${row.pid} ${row.level} ${row.tag}: ${row.message}`,
		)
		.join("\n");
	const copyPath = (path: string) => {
		void navigator.clipboard?.writeText(path).then(
			() => notify("success", "Path copied"),
			() => notify("error", "Could not copy the path"),
		);
	};
	const openRecording = (path: string) => {
		void execOnHost(openFileCommand(path)).then(
			(result) => {
				if (result.exitCode !== 0)
					notify("error", "Could not open the log recording", {
						description: result.stderr.trim() || path,
					});
			},
			() =>
				notify("error", "Could not open the log recording", {
					description: path,
				}),
		);
	};
	const recordingActions = (path: string) => (
		<div className="flex items-center gap-1">
			<Button variant="quiet" size="sm" onClick={() => copyPath(path)}>
				Copy path
			</Button>
			<Button variant="raised" size="sm" onClick={() => openRecording(path)}>
				Open
			</Button>
		</div>
	);
	const toggleRecording = async () => {
		setRecordingBusy(true);
		try {
			const result = await androidToolsRequest<{
				recording: LogRecording | null;
				saved?: LogRecording | null;
			}>(basePath, deviceId, "logs/recording", {
				method: "POST",
				body: JSON.stringify({ action: recording ? "stop" : "start" }),
			});
			setRecording(result.recording);
			if (result.saved)
				notify("success", "Log recording saved", {
					description: result.saved.path,
					action: recordingActions(result.saved.path),
					duration: Number.POSITIVE_INFINITY,
				});
		} catch (cause) {
			notify("error", cause instanceof Error ? cause.message : String(cause));
		} finally {
			setRecordingBusy(false);
		}
	};
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col text-[12px]">
			<div className="px-3">
				<CompactDisclosure
					open={filtersOpen}
					onOpenChange={setFiltersOpen}
					title="Filters"
					className="border-t-0"
				>
					<form
						className="grid grid-cols-2 gap-2"
						onSubmit={(event) => {
							event.preventDefault();
							setApplied({ ...filter });
						}}
					>
						<label className="flex min-w-0 flex-col gap-1 text-white/60">
							App package
							<Input
								placeholder="All apps"
								value={filter.package}
								onChange={(event) =>
									setFilter({ ...filter, package: event.target.value })
								}
							/>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-white/60">
							Search
							<Input
								value={filter.query}
								onChange={(event) =>
									setFilter({ ...filter, query: event.target.value })
								}
							/>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-white/60">
							Level
							<Select
								value={filter.level}
								onValueChange={(level) => {
									if (level !== null) setFilter({ ...filter, level });
								}}
							>
								<SelectTrigger aria-label="Log level" className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{[
										["V", "Verbose"],
										["D", "Debug"],
										["I", "Info"],
										["W", "Warning"],
										["E", "Error"],
										["F", "Fatal"],
									].map(([value, label]) => (
										<SelectItem key={value} value={value}>
											{label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</label>
						<label className="flex min-w-0 flex-col gap-1 text-white/60">
							PID
							<Input
								type="number"
								min="1"
								value={filter.pid}
								onChange={(event) =>
									setFilter({ ...filter, pid: event.target.value })
								}
							/>
						</label>
						<div className="col-span-2 flex justify-end">
							<Button variant="raised" size="sm" type="submit">
								Apply filters
							</Button>
						</div>
					</form>
				</CompactDisclosure>
			</div>
			<div className="flex shrink-0 items-center gap-1 px-3 py-2">
				<Button
					variant={paused ? "raised" : "ghost"}
					size="sm"
					type="button"
					aria-pressed={paused}
					onClick={() => setPaused(!paused)}
				>
					<TextMorph>{paused ? "Resume" : "Pause"}</TextMorph>
				</Button>
				<Button
					variant="quiet"
					size="sm"
					type="button"
					onClick={() => {
						pending.current = [];
						setRows([]);
					}}
				>
					Clear
				</Button>
				<Button
					variant="quiet"
					size="sm"
					type="button"
					disabled={rows.length === 0}
					onClick={() => {
						void navigator.clipboard?.writeText(renderedLogs).then(
							() => notify("success", "Logs copied"),
							() => notify("error", "Could not copy logs"),
						);
					}}
				>
					Copy
				</Button>
				<Button
					variant="quiet"
					size="sm"
					type="button"
					disabled={rows.length === 0}
					onClick={() =>
						downloadAndroidText(
							`${deviceId.replace(/[^a-z0-9-]/gi, "-")}-logcat.txt`,
							renderedLogs,
						)
					}
				>
					Export
				</Button>
				<label className="ms-auto flex shrink-0 items-center gap-1.5 text-white/65">
					<Switch
						aria-label="Follow logs"
						checked={follow}
						onCheckedChange={setFollow}
					/>
					Follow
				</label>
			</div>
			<div className="flex shrink-0 items-center gap-2 px-3 pb-2 text-white/55">
				<span className="min-w-0 flex-1 truncate tabular-nums" role="status">
					<TextMorph>{status}</TextMorph> · {rows.length} shown
					{total > rows.length ? ` · ${total} received` : ""}
				</span>
				<Button
					variant={recording ? "raised" : "ghost"}
					size="sm"
					type="button"
					disabled={recordingBusy}
					aria-pressed={!!recording}
					onClick={() => void toggleRecording()}
				>
					{recording && (
						<span
							className="size-1.5 rounded-full bg-red-500"
							aria-hidden="true"
						/>
					)}
					<TextMorph>{recording ? "Stop recording" : "Record"}</TextMorph>
				</Button>
			</div>
			<div className="relative min-h-32 flex-1 overflow-hidden border-y border-white/[0.08] bg-black/15">
				<div
					ref={viewport}
					className="scroll-fade-y scroll-fade-6 h-full overflow-auto font-mono"
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
									style={{
										height: rowHeight,
										lineHeight: `${rowHeight}px`,
									}}
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
			</div>
			<p className="shrink-0 px-3 py-2 opacity-50">
				Shows up to 2,000 filtered lines from Android’s Logcat buffer. Clear
				view does not erase device logs.
			</p>
			{recording && (
				<div className="flex shrink-0 items-center gap-2 px-3 pb-2">
					<span
						className="size-2 shrink-0 rounded-full bg-red-500"
						aria-label="Recording"
					/>
					<span
						className="min-w-0 flex-1 truncate text-[12px] text-white/60"
						title={recording.path}
					>
						{recording.path}
					</span>
					{recordingActions(recording.path)}
				</div>
			)}
		</div>
	);
}
