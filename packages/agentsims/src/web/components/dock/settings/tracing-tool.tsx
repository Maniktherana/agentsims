import { CircleAlert, ListOrdered, Route, Timer } from "lucide-react";
import { useEffect, useState } from "react";
import {
	elapsedSince,
	formatElapsed,
} from "../../../hooks/simulator/use-screen-recording";
import { useTrace } from "../../../hooks/simulator/use-trace";
import { useTracing } from "../../../hooks/simulator/use-tracing";
import { execOnHost } from "../../../simulator/input/exec";
import { Button } from "../../ui/button";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { SettingSwitch } from "../../ui/setting-switch";
import { SettingRow } from "./simulator-settings-tool";

const TRACE_VALUE =
	"min-w-0 max-w-[190px] truncate text-right text-[12px] font-medium tabular-nums text-white/72";

export function TracingTool({
	udid,
	active,
	traceOpen,
	onTraceOpenChange,
}: {
	udid: string;
	active: boolean;
	traceOpen: boolean;
	onTraceOpenChange: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const tracing = useTracing(execOnHost, udid);
	const trace = useTrace(udid, active && open);
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		setOpen(false);
	}, [udid]);

	useEffect(() => {
		if (!tracing.active || !open) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), 1_000);
		return () => clearInterval(timer);
	}, [tracing.active, open]);

	const detail = trace.detail;
	const live = detail !== null && detail.id === trace.activeId;
	const refused = detail?.calls.filter((call) => call.status === "refused").length ?? 0;
	const errors = detail?.calls.filter((call) => call.status === "error").length ?? 0;
	const spanMs = detail
		? live
			? elapsedSince(detail.startedAt, now)
			: Math.max(0, Date.parse(detail.endedAt ?? "") - Date.parse(detail.startedAt))
		: 0;

	return (
		<CollapsibleSection
			open={open}
			onOpenChange={setOpen}
			summary={
				<div className="flex min-w-0 items-center gap-2">
					<Route size={14} strokeWidth={2} className="shrink-0 text-white/45" />
					<span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/55">
						Trace
					</span>
					<span
						aria-label={tracing.active ? "Tracing" : "Not tracing"}
						className={`size-1.5 shrink-0 rounded-full ${
							tracing.active
								? "agentsims-device-status-breathe bg-success"
								: "bg-white/25"
						}`}
					/>
				</div>
			}
			data-tracing-tool={tracing.active ? "tracing" : "idle"}
		>
			<SettingRow
				icon={<Route size={14} strokeWidth={2} />}
				label="Record every command"
				description="One JSONL record and one screenshot per call"
			>
				<SettingSwitch
					label="Record every command"
					checked={tracing.active}
					disabled={tracing.busy}
					onChange={tracing.toggle}
				/>
			</SettingRow>

			{detail ? (
				<>
					<SettingRow
						icon={<ListOrdered size={14} strokeWidth={2} />}
						label="Calls"
						description={`${refused} refused · ${errors} ${errors === 1 ? "error" : "errors"}`}
					>
						<span className={TRACE_VALUE}>{detail.calls.length}</span>
					</SettingRow>
					<SettingRow
						icon={<Timer size={14} strokeWidth={2} />}
						label={live ? "Elapsed" : "Duration"}
					>
						<span className={TRACE_VALUE}>{formatElapsed(spanMs)}</span>
					</SettingRow>
					<SettingRow
						icon={<span className="text-[10px] font-semibold">ID</span>}
						label="Trace"
					>
						<code
							className="min-w-0 max-w-[150px] truncate rounded-[8px] bg-white/[0.05] px-2 py-1 text-[10px] font-medium text-white/48"
							title={detail.id}
						>
							{detail.id}
						</code>
					</SettingRow>
					<Button
						variant="plain"
						size="custom"
						type="button"
						aria-pressed={traceOpen}
						onClick={() => onTraceOpenChange(!traceOpen)}
						className="flex h-8 items-center justify-center gap-1.5 rounded-[8px] bg-white/[0.09] px-2 text-[11px] font-semibold text-white/82 [transition:background,scale] duration-150 hover:bg-white/[0.13] active:scale-[0.98]"
					>
						{traceOpen ? "Close trace panel" : "Open trace panel"}
					</Button>
				</>
			) : (
				<div className="flex items-start gap-2 rounded-[8px] bg-white/[0.035] px-2.5 py-2 text-[10px] leading-[1.4] text-white/42">
					<CircleAlert size={13} strokeWidth={2} className="mt-px shrink-0" />
					<span>
						{trace.error ??
							"No trace for this device yet. Turn tracing on to record the next commands."}
					</span>
				</div>
			)}
		</CollapsibleSection>
	);
}
