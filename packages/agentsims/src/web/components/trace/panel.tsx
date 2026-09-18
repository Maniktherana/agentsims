import { Route } from "lucide-react";
import {
	useState,
	type KeyboardEventHandler,
	type PointerEventHandler,
} from "react";
import {
	useTrace,
	type TraceSummary,
} from "../../hooks/simulator/use-trace";
import { DevicePanel, type DevicePanelIdentity } from "../ui/device-panel";
import { Select } from "../ui/select";
import { TraceCallList, formatCallTime } from "./call-list";
import { TraceScreenshot } from "./screenshot";

export function traceOptionLabel(trace: TraceSummary): string {
	return [
		trace.name,
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
	const trace = useTrace(device.id, open);
	const [activeIndex, setActiveIndex] = useState(0);
	const detail = trace.detail;
	const calls = detail?.calls ?? [];
	const live = detail !== null && detail.id === trace.activeId;

	return (
		<DevicePanel
			open={open}
			title="Trace"
			icon={<Route size={14} strokeWidth={1.9} />}
			device={device}
			onClose={onClose}
			onMovePointerDown={onMovePointerDown}
			onResizePointerDown={onResizePointerDown}
			onResizeKeyDown={onResizeKeyDown}
			headerActions={
				<>
					{trace.traces.length > 0 && (
						<Select
							label="Trace"
							value={trace.selectedId ?? ""}
							options={trace.traces.map((entry) => ({
								value: entry.id,
								label: traceOptionLabel(entry),
							}))}
							onChange={trace.select}
							className="h-6 min-w-0 max-w-[190px] rounded-[8px] border border-white/10 bg-white/[0.06] px-2 py-0 text-[11px] leading-none text-white/90"
						/>
					)}
					{live && (
						<span
							aria-label="Tracing"
							className="agentsims-device-status-breathe size-1.5 shrink-0 rounded-full bg-success"
						/>
					)}
					<span className="shrink-0 font-mono text-[11px] tabular-nums text-white/45">
						{`${calls.length} calls`}
					</span>
				</>
			}
		>
			{!detail || calls.length === 0 ? (
				<div className="grid h-full place-items-center px-6 text-center">
					<p className="text-[12px] leading-[1.6] text-white/45">
						{trace.error ??
							(live
								? "Waiting for the first call…"
								: "No trace for this device yet.")}
						{!live && !trace.error && (
							<code className="mt-2 block font-mono text-[11px] text-white/35">
								{`agentsims trace start -d ${device.id}`}
							</code>
						)}
					</p>
				</div>
			) : (
				<div className="grid h-full min-h-0 grid-cols-[240px_minmax(0,1fr)] gap-2 p-2">
					<TraceScreenshot
						traceId={detail.id}
						calls={calls}
						index={activeIndex}
					/>
					<TraceCallList
						key={detail.id}
						traceId={detail.id}
						calls={calls}
						onActiveIndexChange={setActiveIndex}
					/>
				</div>
			)}
		</DevicePanel>
	);
}
