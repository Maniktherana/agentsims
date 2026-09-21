import { FolderOpen, Route, Search } from "lucide-react";
import {
	useState,
	type KeyboardEventHandler,
	type PointerEventHandler,
} from "react";
import { openFileCommand } from "../../hooks/simulator/use-screen-recording";
import {
	openTraceSource,
	useTrace,
	type TraceSource,
	type TraceSummary,
} from "../../hooks/simulator/use-trace";
import { execOnHost, shellEscape } from "../../simulator/input/exec";
import { DevicePanel, type DevicePanelIdentity } from "../ui/device-panel";
import { IconButton } from "../ui/icon-button";
import { Select } from "../ui/select";
import { notify } from "../ui/toast";
import { TraceCallList, formatCallTime } from "./call-list";
import { TraceScreenshot } from "./screenshot";

export async function traceLibraryDirectory(): Promise<string> {
	const response = await fetch("/traces/directory", { cache: "no-store" });
	if (!response.ok) throw new Error("The trace library is unavailable.");
	const body = (await response.json()) as { directory?: unknown };
	if (typeof body.directory !== "string" || body.directory.length === 0)
		throw new Error("The server returned an invalid trace directory.");
	return body.directory;
}

/** Open a native directory chooser at the configured trace library. */
export function traceFolderPickerCommand(directory: string): string {
	return `TRACE_ROOT=${shellEscape(directory)}
if command -v osascript >/dev/null 2>&1; then
  osascript - "$TRACE_ROOT" <<'APPLESCRIPT'
on run argv
  set rootPath to item 1 of argv
  return POSIX path of (choose folder with prompt "Open trace" default location (POSIX file rootPath))
end run
APPLESCRIPT
elif command -v zenity >/dev/null 2>&1; then
  zenity --file-selection --directory --filename="$TRACE_ROOT/"
else
  exit 127
fi`;
}

export function traceOptionLabel(
	trace: TraceSummary,
	showDevice = false,
): string {
	return [
		trace.name,
		showDevice ? trace.device.replace(/^android:/, "") : null,
		formatCallTime(trace.startedAt),
		`${trace.calls} calls`,
		trace.endedAt ? null : "live",
	]
		.filter(Boolean)
		.join(" · ");
}

export function TracePanel({
	open,
	device,
	onClose,
	onMovePointerDown,
	onResizePointerDown,
	onResizeKeyDown,
}: {
	open: boolean;
	device: DevicePanelIdentity;
	onClose: () => void;
	onMovePointerDown?: PointerEventHandler<HTMLElement>;
	onResizePointerDown?: PointerEventHandler<HTMLDivElement>;
	onResizeKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
	const [source, setSource] = useState<TraceSource | null>(null);
	const trace = useTrace(device.id, open, "all", source);
	const [activeIndex, setActiveIndex] = useState(0);
	const detail = trace.detail;
	const calls = detail?.calls ?? [];
	const selectedSummary = trace.traces.find((entry) => entry.id === detail?.id);
	const live = !source && selectedSummary?.endedAt === null;
	const viewedDevice: DevicePanelIdentity = detail
		? {
				...device,
				id: detail.device,
				name:
					detail.device === device.id
						? device.name
						: detail.device.replace(/^android:/, ""),
				platform: detail.platform,
				connected: detail.device === device.id ? device.connected : false,
			}
		: device;

	const openLibrary = () => {
		setSource(null);
		setActiveIndex(0);
		void traceLibraryDirectory()
			.then((directory) => execOnHost(openFileCommand(directory)))
			.then((result) => {
				if (result.exitCode !== 0)
					throw new Error("The host did not open the directory.");
			})
			.catch(() => notify("error", "Could not open the trace library"));
	};

	const chooseTrace = () => {
		void traceLibraryDirectory()
			.then(async (directory) => ({
				directory,
				result: await execOnHost(traceFolderPickerCommand(directory)),
			}))
			.then(async ({ result }) => {
				if (result.exitCode !== 0) {
					if (!result.stderr.trim() || /cancel/i.test(result.stderr)) return;
					throw new Error("The host did not open the trace picker.");
				}
				const next = await openTraceSource(result.stdout.trim());
				setActiveIndex(0);
				setSource(next);
			})
			.catch((cause) =>
				notify("error", "Could not open trace", {
					description: cause instanceof Error ? cause.message : String(cause),
				}),
			);
	};

	return (
		<DevicePanel
			open={open}
			title="Trace"
			icon={<Route size={14} strokeWidth={1.9} />}
			device={viewedDevice}
			onClose={onClose}
			onMovePointerDown={onMovePointerDown}
			onResizePointerDown={onResizePointerDown}
			onResizeKeyDown={onResizeKeyDown}
		>
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex min-w-0 shrink-0 items-center gap-2 px-2 pb-2">
					<IconButton
						label="Open trace library"
						tooltip="Open trace library"
						size="panel"
						surface="toolbar"
						onClick={openLibrary}
					>
						<FolderOpen size={14} strokeWidth={1.9} />
					</IconButton>
					<IconButton
						label="Choose trace folder"
						tooltip="Choose trace folder"
						size="panel"
						surface="toolbar"
						onClick={chooseTrace}
					>
						<Search size={14} strokeWidth={1.9} />
					</IconButton>
					{trace.traces.length > 0 ? (
						<Select
							label="Trace"
							value={trace.selectedId ?? ""}
							options={trace.traces.map((entry) => ({
								value: entry.id,
								label: traceOptionLabel(entry, true),
							}))}
							onChange={(id) => {
								setActiveIndex(0);
								trace.select(id);
							}}
							className="min-w-0 flex-1"
						/>
					) : (
						<span className="min-w-0 flex-1 text-[12px] text-white/40">
							No traces found
						</span>
					)}
					<span className="shrink-0 font-mono text-[11px] tabular-nums text-white/45">
						{live ? "Live" : `${calls.length} calls`}
					</span>
				</div>

				{!detail || calls.length === 0 ? (
					<div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
						<p className="text-[12px] leading-[1.6] text-white/45">
							{trace.error ??
								(live
									? "Waiting for the first call…"
									: "No traces found.")}
						</p>
					</div>
				) : (
					<div className="grid min-h-0 flex-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
						<TraceScreenshot
							traceId={detail.id}
							calls={calls}
							index={activeIndex}
							sourceId={source?.id}
						/>
						<div className="min-h-0">
							<TraceCallList
								key={detail.id}
								traceId={detail.id}
								device={detail.device}
								calls={calls}
								onActiveIndexChange={setActiveIndex}
							/>
						</div>
					</div>
				)}
			</div>
		</DevicePanel>
	);
}
