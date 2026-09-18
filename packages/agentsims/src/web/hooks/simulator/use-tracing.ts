import { useCallback, useEffect, useRef, useState } from "react";
import { notify } from "../../components/ui/toast";
import { shellEscape, type ExecResult } from "../../simulator/input/exec";
import {
	errorMessage,
	execFailureMessage,
	parseJsonObject,
} from "./use-screen-recording";

/** How often an active trace re-checks the CLI, in milliseconds. */
export const TRACING_POLL_INTERVAL_MS = 5_000;

export type ExecFn = (command: string) => Promise<ExecResult>;

/** The trace the CLI reports for a device. */
export interface ActiveTrace {
	id: string;
	directory: string;
	startedAt: string;
	calls: number;
}

export type TracingState =
	| { status: "idle" }
	| { status: "starting" }
	| ({ status: "tracing" } & ActiveTrace)
	| ({ status: "stopping" } & ActiveTrace);

export type TracingAction =
	| { type: "start" }
	| ({ type: "started" } & ActiveTrace)
	| { type: "stop" }
	| { type: "stopped" }
	| { type: "failed" }
	| { type: "status"; trace: ActiveTrace | null };

export const IDLE_TRACING_STATE: TracingState = { status: "idle" };

export function tracingReducer(
	state: TracingState,
	action: TracingAction,
): TracingState {
	switch (action.type) {
		case "start":
			return state.status === "idle" ? { status: "starting" } : state;
		case "started":
			return state.status === "starting"
				? {
						status: "tracing",
						id: action.id,
						directory: action.directory,
						startedAt: action.startedAt,
						calls: action.calls,
					}
				: state;
		case "stop":
			return state.status === "tracing" ? { ...state, status: "stopping" } : state;
		case "stopped":
			return state.status === "stopping" ? IDLE_TRACING_STATE : state;
		case "failed":
			if (state.status === "starting") return IDLE_TRACING_STATE;
			if (state.status === "stopping") return { ...state, status: "tracing" };
			return state;
		case "status":
			if (state.status === "starting" || state.status === "stopping")
				return state;
			if (!action.trace)
				return state.status === "idle" ? state : IDLE_TRACING_STATE;
			if (
				state.status === "tracing" &&
				state.id === action.trace.id &&
				state.calls === action.trace.calls
			)
				return state;
			return { status: "tracing", ...action.trace };
	}
}

export function isTracingBusy(state: TracingState): boolean {
	return state.status === "starting" || state.status === "stopping";
}

export function isTracingActive(state: TracingState): boolean {
	return state.status === "tracing" || state.status === "stopping";
}

export type TraceSubcommand = "start" | "stop" | "status";

export function traceCommand(sub: TraceSubcommand, device: string): string {
	return `agentsims trace ${sub} -d ${shellEscape(device)} --json`;
}

export interface TraceStopResult {
	id: string;
	directory: string;
	calls: number;
}

function readString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`missing "${key}" in command output`);
	return value;
}

function readCount(source: Record<string, unknown>): number {
	const value = source.calls;
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `trace start --json` → `{ device, id, directory, startedAt }`. */
export function parseTraceStart(stdout: string): ActiveTrace {
	const json = parseJsonObject(stdout);
	return {
		id: readString(json, "id"),
		directory: readString(json, "directory"),
		startedAt: readString(json, "startedAt"),
		calls: readCount(json),
	};
}

/** `trace stop --json` → `{ device, id, directory, startedAt, endedAt, calls }`. */
export function parseTraceStop(stdout: string): TraceStopResult {
	const json = parseJsonObject(stdout);
	return {
		id: readString(json, "id"),
		directory: readString(json, "directory"),
		calls: readCount(json),
	};
}

/** `trace status --json` → `{ device, active: null | { id, directory, … } }`. */
export function parseTraceStatus(stdout: string): ActiveTrace | null {
	const json = parseJsonObject(stdout);
	const active = json.active;
	if (active === null || active === undefined) return null;
	if (typeof active !== "object" || Array.isArray(active))
		throw new Error(`unexpected "active" in command output`);
	const trace = active as Record<string, unknown>;
	return {
		id: readString(trace, "id"),
		directory: readString(trace, "directory"),
		startedAt: readString(trace, "startedAt"),
		calls: readCount(trace),
	};
}

export interface TracingController {
	state: TracingState;
	active: boolean;
	busy: boolean;
	/** The id of the running trace, so the panel can follow it. */
	activeId: string | null;
	toggle: () => void;
}

export function useTracing(
	exec: ExecFn,
	device: string | null | undefined,
): TracingController {
	const [state, setState] = useState<TracingState>(IDLE_TRACING_STATE);
	const stateRef = useRef(state);
	stateRef.current = state;
	const deviceRef = useRef(device);
	deviceRef.current = device;
	const execRef = useRef(exec);
	execRef.current = exec;

	const dispatch = useCallback(
		(forDevice: string | null | undefined, action: TracingAction) => {
			if (deviceRef.current !== forDevice) return;
			setState((current) => tracingReducer(current, action));
		},
		[],
	);

	const run = useCallback(
		async (sub: TraceSubcommand, forDevice: string): Promise<string> => {
			const result = await execRef.current(traceCommand(sub, forDevice));
			if (result.exitCode !== 0) throw new Error(execFailureMessage(result));
			return result.stdout;
		},
		[],
	);

	// A trace can start from a terminal or another tab, and status failures stay
	// silent so an older CLI without `trace` does not toast on every mount.
	const syncStatus = useCallback(
		async (forDevice: string) => {
			try {
				const trace = parseTraceStatus(await run("status", forDevice));
				dispatch(forDevice, { type: "status", trace });
			} catch {
				// The next poll or click reports the truth.
			}
		},
		[dispatch, run],
	);

	useEffect(() => {
		setState(IDLE_TRACING_STATE);
		if (!device) return;
		void syncStatus(device);
	}, [device, syncStatus]);

	const active = isTracingActive(state);

	useEffect(() => {
		if (!device || !active) return;
		const timer = setInterval(() => {
			void syncStatus(device);
		}, TRACING_POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [device, active, syncStatus]);

	const toggle = useCallback(() => {
		const forDevice = deviceRef.current;
		if (!forDevice) return;
		const current = stateRef.current;
		if (current.status === "idle") {
			dispatch(forDevice, { type: "start" });
			void (async () => {
				try {
					const started = parseTraceStart(await run("start", forDevice));
					dispatch(forDevice, { type: "started", ...started });
				} catch (error) {
					dispatch(forDevice, { type: "failed" });
					notify("error", "Trace did not start", {
						description: errorMessage(error),
					});
				}
			})();
			return;
		}
		if (current.status !== "tracing") return;
		dispatch(forDevice, { type: "stop" });
		void (async () => {
			try {
				const stopped = parseTraceStop(await run("stop", forDevice));
				dispatch(forDevice, { type: "stopped" });
				notify("success", `Trace saved · ${stopped.calls} calls`, {
					description: stopped.directory,
				});
			} catch (error) {
				dispatch(forDevice, { type: "failed" });
				notify("error", "Trace did not stop", {
					description: errorMessage(error),
				});
			}
		})();
	}, [dispatch, run]);

	return {
		state,
		active,
		busy: isTracingBusy(state),
		activeId: state.status === "idle" || state.status === "starting" ? null : state.id,
		toggle,
	};
}
