import { FolderOpen, Route } from "lucide-react";
import { useEffect, useState } from "react";
import { TextMorph } from "torph/react";
import {
	elapsedSince,
	formatElapsed,
	openFileCommand,
} from "../../../hooks/simulator/use-screen-recording";
import { useTrace } from "../../../hooks/simulator/use-trace";
import { useTracing } from "../../../hooks/simulator/use-tracing";
import { execOnHost } from "../../../simulator/input/exec";
import { Button } from "@agentsims/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@agentsims/ui/components/tooltip";
import { CollapsibleSection } from "../../ui/collapsible-section";
import { CopyButton } from "../../ui/copy-button";
import { Switch } from "@agentsims/ui/components/switch";
import { notify } from "../../ui/toast";
import { SettingRow } from "./simulator-settings-tool";

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
	const refused =
		detail?.calls.filter((call) => call.status === "refused").length ?? 0;
	const errors =
		detail?.calls.filter((call) => call.status === "error").length ?? 0;
	const spanMs = detail
		? live
			? elapsedSince(detail.startedAt, now)
			: Math.max(
					0,
					Date.parse(detail.endedAt ?? "") - Date.parse(detail.startedAt),
				)
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
					<span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-white/55">
						Trace
					</span>
				</div>
			}
			data-tracing-tool={tracing.active ? "tracing" : "idle"}
		>
			<SettingRow
				icon={<Route size={14} strokeWidth={2} />}
				label="Enable tracing"
			>
				<Switch
					aria-label="Enable tracing"
					checked={tracing.active}
					disabled={tracing.busy}
					onCheckedChange={tracing.toggle}
				/>
			</SettingRow>

			{detail ? (
				<div className="flex min-w-0 items-center gap-1.5 ps-7 pt-1">
					<div className="flex min-w-0 flex-1 items-center gap-2 text-[12px] tabular-nums">
						<span className="min-w-0 truncate text-white/62" title={detail.id}>
							{summary?.name ?? (live ? "Current trace" : "Latest trace")}
						</span>
						<span className="shrink-0 text-white/42">
							{detail.calls.length} calls
						</span>
						{refused > 0 && (
							<span className="shrink-0 text-warning">{refused} refused</span>
						)}
						{errors > 0 && (
							<span className="shrink-0 text-danger">
								{errors} {errors === 1 ? "error" : "errors"}
							</span>
						)}
						<span className="shrink-0 text-white/42">
							{formatElapsed(spanMs)}
						</span>
					</div>
					<CopyButton
						text={detail.id}
						label="Copy trace id"
						size="icon-xs"
						variant="toolbar"
					/>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label="Open trace folder"
									size="icon-xs"
									variant="toolbar"
									disabled={!directory}
									onClick={openFolder}
								/>
							}
						>
							<FolderOpen size={12} strokeWidth={2} />
						</TooltipTrigger>
						<TooltipContent>Open trace folder</TooltipContent>
					</Tooltip>
					<Button
						variant="flat"
						size="sm"
						aria-pressed={traceOpen}
						onClick={() => onTraceOpenChange(!traceOpen)}
					>
						<TextMorph>{traceOpen ? "Close viewer" : "View trace"}</TextMorph>
					</Button>
				</div>
			) : (
				<div className="flex items-center gap-3 ps-7 pt-1">
					<p className="min-w-0 flex-1 text-[12px] leading-[1.5] text-white/42">
						{trace.error ?? "No trace recorded for this device."}
					</p>
					<Button
						variant="flat"
						size="sm"
						aria-pressed={traceOpen}
						onClick={() => onTraceOpenChange(!traceOpen)}
					>
						<TextMorph>{traceOpen ? "Close viewer" : "Open viewer"}</TextMorph>
					</Button>
				</div>
			)}
		</CollapsibleSection>
	);
}
