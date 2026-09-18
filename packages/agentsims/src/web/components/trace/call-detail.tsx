import { Copy } from "lucide-react";
import { renderCommandOutput } from "../../../core/tools/output/render";
import type { TraceCommand } from "../../../core/tools/traces/trace-file";
import type { TraceCall } from "../../hooks/simulator/use-trace";
import { IconButton } from "../ui/icon-button";
import { notify } from "../ui/toast";

export function renderCallOutput(command: TraceCommand, result: unknown): string {
	if (result === null || result === undefined) return "";
	try {
		return renderCommandOutput(command, result);
	} catch {
		return JSON.stringify(result, null, 2);
	}
}

export function callOutputText(call: TraceCall): string {
	return call.status === "error"
		? `agentsims: ${call.error?.message ?? "failed"}`
		: renderCallOutput(call.command as TraceCommand, call.result);
}

export function callRequestLine(call: TraceCall): string {
	return call.request === null || call.request === undefined
		? call.command
		: `${call.command} ${JSON.stringify(call.request)}`;
}

export function TraceCallDetail({
	call,
	maxHeight,
}: {
	call: TraceCall;
	maxHeight: number;
}) {
	const output = callOutputText(call);

	return (
		<div data-trace-call-detail className="flex min-w-0 flex-col gap-1 px-2 pb-2">
			<div className="flex min-w-0 items-center gap-2">
				<code
					className="min-w-0 flex-1 truncate font-mono text-[11px] text-white/45"
					title={callRequestLine(call)}
				>
					{callRequestLine(call)}
				</code>
				<IconButton
					label="Copy output"
					size="row"
					surface="toolbar"
					onClick={() => {
						void navigator.clipboard?.writeText(output).then(
							() => notify("success", "Output copied"),
							() => notify("error", "Copy failed"),
						);
					}}
				>
					<Copy size={12} strokeWidth={2} />
				</IconButton>
			</div>
			<pre
				style={{ maxHeight }}
				className={`overflow-auto whitespace-pre rounded-[var(--agentsims-radius-row)] bg-panel-deep px-2 py-1.5 font-mono text-[12px] leading-[1.45] [scrollbar-width:thin] ${
					call.status === "error" ? "text-danger" : "text-white/75"
				}`}
			>
				{output}
			</pre>
		</div>
	);
}
