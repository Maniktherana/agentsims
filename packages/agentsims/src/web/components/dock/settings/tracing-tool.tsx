import { FolderOpen, Route } from "lucide-react";
import { useEffect, useState } from "react";
import {
	elapsedSince,
	formatElapsed,
	openFileCommand,
} from "../../../hooks/simulator/use-screen-recording";
import { useTrace } from "../../../hooks/simulator/use-trace";
import { useTracing } from "../../../hooks/simulator/use-tracing";
import { execOnHost } from "../../../simulator/input/exec";
import { Button } from "../../ui/button";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { CopyButton } from "../../ui/copy-button";
import { IconButton } from "../../ui/icon-button";
import { SettingSwitch } from "../../ui/setting-switch";
import { notify } from "../../ui/toast";
import { SettingRow } from "./simulator-settings-tool";

function tone(count: number, colour: string): string {
	return count > 0 ? colour : "text-white/42";
}

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
	const summary = trace.traces.find((entry) => entry.id === detail?.id);
	const live = detail !== null && detail.id === trace.activeId;
	const refused = detail?.calls.filter((call) => call.status === "refused").length ?? 0;
	const errors = detail?.calls.filter((call) => call.status === "error").length ?? 0;
	const spanMs = detail
		? live
			? elapsedSince(detail.startedAt, now)
			: Math.max(0, Date.parse(detail.endedAt ?? "") - Date.parse(detail.startedAt))
		: 0;
	const directory =
		summary?.directory ??
		("directory" in tracing.state ? tracing.state.directory : null);

	const openFolder = () => {
		if (!directory) return;
		void execOnHost(openFileCommand(directory)).then(
			(result) => {
				if (result.exitCode !== 0)
					notify("error", "Could not open the trace folder", {
						description: result.stderr.trim() || directory,
					});
			},
			() => notify("error", "Could not open the trace folder"),
		);
	};

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
			<SettingRow icon={<Route size={14} strokeWidth={2} />} label="Trace commands">
				<SettingSwitch
					label="Trace commands"
					checked={tracing.active}
					disabled={tracing.busy}
					onChange={tracing.toggle}
				/>
			</SettingRow>

			{detail ? (
				<div className="flex flex-col gap-3 pl-[26px] pt-1">
					<div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-white/72">
						{live ? (
							<span className="agentsims-device-status-breathe size-1.5 shrink-0 rounded-full bg-success" />
						) : null}
						<span>{detail.calls.length} calls</span>
						<span className="text-white/25">·</span>
						<span className={tone(refused, "text-warning")}>{refused} refused</span>
						<span className="text-white/25">·</span>
						<span className={tone(errors, "text-danger")}>
							{errors} {errors === 1 ? "error" : "errors"}
						</span>
						<span className="text-white/25">·</span>
						<span>{formatElapsed(spanMs)}</span>
					</div>
					<div className="flex items-start gap-1.5">
						<code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-[1.5] text-white/48">
							{detail.id}
						</code>
						<CopyButton text={detail.id} label="Copy trace id" size="row" surface="toolbar" />
						<IconButton
							label="Open trace folder"
							size="row"
							surface="toolbar"
							disabled={!directory}
							onClick={openFolder}
						>
							<FolderOpen size={12} strokeWidth={2} />
						</IconButton>
					</div>
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
				</div>
			) : (
				<p className="pl-[26px] text-[11px] leading-[1.5] text-white/42">
					{trace.error ?? "No trace for this device yet. Turn tracing on to record the next commands."}
				</p>
			)}
		</CollapsibleSection>
	);
}
