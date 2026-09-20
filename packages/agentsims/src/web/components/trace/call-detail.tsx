import { renderCommandOutput } from "../../../core/tools/output/render";
import type { TraceCommand } from "../../../core/tools/traces/trace-file";
import type { TraceCall } from "../../hooks/simulator/use-trace";
import { CopyButton } from "../ui/copy-button";

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

function shellArg(value: unknown): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (/^[a-zA-Z0-9_@%.,:/+-]+$/.test(text)) return text;
	return `'${text.replaceAll("'", `'\\''`)}'`;
}

function flagName(key: string): string {
	return key
		.replace(/Ms$/, "")
		.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function flags(values: Record<string, unknown>, omitted: Set<string>): string[] {
	return Object.entries(values).flatMap(([key, value]) => {
		if (omitted.has(key) || value === undefined || value === null || value === false)
			return [];
		const flag = `--${flagName(key)}`;
		return value === true ? [flag] : [flag, shellArg(value)];
	});
}

/** Reconstruct a readable CLI command from the request stored in the trace. */
export function traceCommandLine(call: TraceCall, device: string): string {
	const request =
		call.request && typeof call.request === "object" && !Array.isArray(call.request)
			? (call.request as Record<string, unknown>)
			: {};
	const parts = ["agentsims"];
	const omitted = new Set<string>();
	let values = request;

	if (call.command.startsWith("app:")) {
		parts.push("app", call.command.slice("app:".length));
		omitted.add("operation");
		if (request.value !== undefined) {
			parts.push(shellArg(request.value));
			omitted.add("value");
		}
	} else {
		parts.push(call.command === "button" ? "press" : call.command);
		if (Array.isArray(request.actions) && request.actions.length > 0) {
			const action = request.actions[0];
			if (action && typeof action === "object" && !Array.isArray(action)) {
				values = {
					...(action as Record<string, unknown>),
					...Object.fromEntries(
						Object.entries(request).filter(([key]) => key !== "actions"),
					),
				};
				omitted.add("type");
			}
		}
		const positionalKeys: Record<string, string[]> = {
			find: ["q"],
			tap: ["target"],
			"long-press": ["target"],
			type: ["text"],
			fill: ["text"],
			key: ["key"],
			button: ["button"],
			rotate: ["orientation"],
			swipe: ["from", "to"],
		};
		for (const key of positionalKeys[call.command] ?? []) {
			if (values[key] !== undefined) parts.push(shellArg(values[key]));
			omitted.add(key);
		}
	}

	parts.push("-d", shellArg(device), ...flags(values, omitted));
	return parts.join(" ");
}

export function TraceCallDetail({
	call,
	device,
	maxHeight,
}: {
	call: TraceCall;
	device: string;
	maxHeight: number;
}) {
	const command = traceCommandLine(call, device);
	const output = callOutputText(call);

	return (
		<div
			data-trace-call-detail
			className="flex min-w-0 flex-col gap-3 px-3 pb-3 pt-2"
		>
			<section className="flex min-w-0 items-center gap-2 rounded-[7px] border border-white/[0.07] bg-white/[0.035] px-2 py-1.5">
				<code className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-white/72">
					{command}
				</code>
				<CopyButton text={command} label="Copy command" size="row" surface="toolbar" />
			</section>
			<section className="min-w-0">
				<div className="mb-1.5 flex items-center gap-2">
					<h3 className="min-w-0 flex-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/42">
						Output
					</h3>
					<CopyButton text={output} label="Copy output" size="row" surface="toolbar" />
				</div>
				<div
					style={{ maxHeight: Math.max(160, Math.min(maxHeight, 420)) }}
					className="overflow-scroll overscroll-contain rounded-[7px] border border-white/[0.07] bg-white/[0.018] [scrollbar-width:thin]"
				>
					<pre
						className={`min-w-max whitespace-pre p-2 font-mono text-[11px] leading-[1.5] ${
							call.status === "error" ? "text-danger" : "text-white/72"
						}`}
					>
						{output || "No output"}
					</pre>
				</div>
			</section>
		</div>
	);
}
