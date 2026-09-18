import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { notify } from "../../components/ui/toast";
import { shellEscape, type ExecResult } from "../../simulator/input/exec";

// Screen recording state for one device. The CLI owns the recording; this hook
// only drives `agentsims record start|stop|status --json` over the toolbar exec
// channel and keeps the button in step with it.
//
// The CLI is the single source of truth: a recording can start from a terminal
// or from another tab, so the hook asks for `status` once per device and again
// every POLL_INTERVAL_MS while it believes a recording runs.

/** How often a live recording re-checks the CLI, in milliseconds. */
export const RECORDING_POLL_INTERVAL_MS = 5_000;
/** How often the elapsed label updates, in milliseconds. */
export const RECORDING_TICK_INTERVAL_MS = 500;

export type ExecFn = (command: string) => Promise<ExecResult>;

/** An active recording, as reported by the CLI. */
export interface ActiveRecording {
	path: string;
	startedAt: string;
}

export type ScreenRecordingState =
	| { status: "idle" }
	| { status: "starting" }
	| ({ status: "recording" } & ActiveRecording)
	| ({ status: "stopping" } & ActiveRecording);

export type ScreenRecordingAction =
	| { type: "start" }
	| ({ type: "started" } & ActiveRecording)
	| { type: "stop" }
	| { type: "stopped" }
	| { type: "failed" }
	| { type: "status"; recording: ActiveRecording | null }
	| { type: "reset" };

export const IDLE_RECORDING_STATE: ScreenRecordingState = { status: "idle" };

// A pure reducer keeps the transitions testable without a DOM. Every exec call
// dispatches a request action first and a result action later, so a failure
// only has to undo the request.
export function screenRecordingReducer(
	state: ScreenRecordingState,
	action: ScreenRecordingAction,
): ScreenRecordingState {
	switch (action.type) {
		case "start":
			return state.status === "idle" ? { status: "starting" } : state;
		case "started":
			return state.status === "starting"
				? {
						status: "recording",
						path: action.path,
						startedAt: action.startedAt,
					}
				: state;
		case "stop":
			return state.status === "recording"
				? {
						status: "stopping",
						path: state.path,
						startedAt: state.startedAt,
					}
				: state;
		case "stopped":
			return state.status === "stopping" ? IDLE_RECORDING_STATE : state;
		// A failed request returns the button to the state it had before the
		// click. `stopping` carries the recording it tried to stop, so the
		// indicator comes back intact.
		case "failed":
			if (state.status === "starting") return IDLE_RECORDING_STATE;
			if (state.status === "stopping")
				return {
					status: "recording",
					path: state.path,
					startedAt: state.startedAt,
				};
			return state;
		// Status only corrects a settled state. A request in flight already knows
		// more than the poll that raced it.
		case "status":
			if (state.status === "starting" || state.status === "stopping")
				return state;
			if (!action.recording)
				return state.status === "idle" ? state : IDLE_RECORDING_STATE;
			if (
				state.status === "recording" &&
				state.path === action.recording.path &&
				state.startedAt === action.recording.startedAt
			)
				return state;
			return {
				status: "recording",
				path: action.recording.path,
				startedAt: action.recording.startedAt,
			};
		case "reset":
			return state.status === "idle" ? state : IDLE_RECORDING_STATE;
	}
}

/** True while a request is in flight and the button must not accept a click. */
export function isRecordingBusy(state: ScreenRecordingState): boolean {
	return state.status === "starting" || state.status === "stopping";
}

/** True while the device records, including the stop request. */
export function isRecordingActive(state: ScreenRecordingState): boolean {
	return state.status === "recording" || state.status === "stopping";
}

// -- CLI contract (AS-RECORD-CORE) --------------------------------------

export type RecordSubcommand = "start" | "stop" | "status";

export function recordCommand(sub: RecordSubcommand, device: string): string {
	return `agentsims record ${sub} -d ${shellEscape(device)} --json`;
}

export interface RecordStopResult {
	paths: string[];
	frames: number;
	durationMs: number;
	bytes: number;
}

export function parseJsonObject(stdout: string): Record<string, unknown> {
	// The CLI prints the server object verbatim, but a stray warning line must
	// not break the button. Read the outermost object instead of the whole
	// stream.
	const start = stdout.indexOf("{");
	const end = stdout.lastIndexOf("}");
	if (start === -1 || end < start) throw new Error("no JSON in command output");
	const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
		throw new Error("command output is not a JSON object");
	return parsed as Record<string, unknown>;
}

function readString(source: Record<string, unknown>, key: string): string {
	const value = source[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`missing "${key}" in command output`);
	return value;
}

function readNumber(source: Record<string, unknown>, key: string): number {
	const value = source[key];
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** `record start --json` → `{ device, path, startedAt }`. */
export function parseRecordStart(stdout: string): ActiveRecording {
	const json = parseJsonObject(stdout);
	return {
		path: readString(json, "path"),
		startedAt: readString(json, "startedAt"),
	};
}

/** `record stop --json` → `{ device, paths, frames, durationMs, bytes, … }`. */
export function parseRecordStop(stdout: string): RecordStopResult {
	const json = parseJsonObject(stdout);
	const paths = json.paths;
	if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string"))
		throw new Error(`missing "paths" in command output`);
	if (paths.length === 0) throw new Error("no recording file was written");
	return {
		paths: paths as string[],
		frames: readNumber(json, "frames"),
		durationMs: readNumber(json, "durationMs"),
		bytes: readNumber(json, "bytes"),
	};
}

/** `record status --json` → `{ device, recording: null | { path, startedAt, … } }`. */
export function parseRecordStatus(stdout: string): ActiveRecording | null {
	const json = parseJsonObject(stdout);
	const recording = json.recording;
	if (recording === null || recording === undefined) return null;
	if (typeof recording !== "object" || Array.isArray(recording))
		throw new Error(`unexpected "recording" in command output`);
	const active = recording as Record<string, unknown>;
	return {
		path: readString(active, "path"),
		startedAt: readString(active, "startedAt"),
	};
}

/** The message to show for a command that exited non-zero. */
export function execFailureMessage(result: ExecResult): string {
	const text = `${result.stderr}\n${result.stdout}`;
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (!line) continue;
		// CLI errors read `agentsims: <message>`. Show only the message.
		return line.startsWith("agentsims:")
			? line.slice("agentsims:".length).trim()
			: line;
	}
	return `Command exited with code ${result.exitCode}`;
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// -- Elapsed time -------------------------------------------------------

/** Milliseconds since an ISO timestamp, never negative. */
export function elapsedSince(startedAt: string, now: number): number {
	const started = Date.parse(startedAt);
	if (Number.isNaN(started)) return 0;
	return Math.max(0, now - started);
}

/** Elapsed time as `m:ss`, or `h:mm:ss` after one hour. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const seconds = total % 60;
	const minutes = Math.floor(total / 60) % 60;
	const hours = Math.floor(total / 3600);
	const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
	const ss = String(seconds).padStart(2, "0");
	return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Bytes as a short human size. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
	const mb = bytes / (1024 * 1024);
	return mb < 1
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${mb.toFixed(1)} MB`;
}

/** The title of the "Recording saved" toast. */
export function stopTitle(result: RecordStopResult): string {
	const facts = [
		formatElapsed(result.durationMs),
		`${result.frames} frames`,
		formatBytes(result.bytes),
	];
	return `Recording saved · ${facts.join(" · ")}`;
}

/** The path line under the "Recording saved" toast. */
export function stopDescription(result: RecordStopResult): string {
	const [first, ...rest] = result.paths;
	if (!first) return "";
	return rest.length > 0 ? `${first} +${rest.length} more` : first;
}

async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard?.writeText(text);
}

function copyPathAction(paths: string[]) {
	return createElement(
		"button",
		{
			type: "button",
			className:
				"shrink-0 rounded-md border border-white/12 px-2 py-1 text-[11px] font-medium text-white/80 hover:bg-white/10",
			onClick: (event: { stopPropagation: () => void }) => {
				event.stopPropagation();
				void copyToClipboard(paths.join("\n")).then(
					() => notify("success", "Path copied"),
					() => notify("error", "Copy failed"),
				);
			},
		},
		"Copy",
	);
}

// -- Hook ---------------------------------------------------------------

export interface ScreenRecordingController {
	state: ScreenRecordingState;
	/** Milliseconds since the recording started, or null when idle. */
	elapsedMs: number | null;
	active: boolean;
	busy: boolean;
	toggle: () => void;
}

export function useScreenRecording(
	exec: ExecFn,
	device: string | null | undefined,
): ScreenRecordingController {
	const [state, setState] =
		useState<ScreenRecordingState>(IDLE_RECORDING_STATE);
	const [now, setNow] = useState(() => Date.now());
	const stateRef = useRef(state);
	stateRef.current = state;
	// The device can change while a command is in flight. Every reply checks the
	// device it belongs to before it touches the state.
	const deviceRef = useRef(device);
	deviceRef.current = device;
	const execRef = useRef(exec);
	execRef.current = exec;

	const dispatch = useCallback(
		(forDevice: string | null | undefined, action: ScreenRecordingAction) => {
			if (deviceRef.current !== forDevice) return;
			setState((current) => screenRecordingReducer(current, action));
		},
		[],
	);

	const run = useCallback(
		async (sub: RecordSubcommand, forDevice: string): Promise<string> => {
			const result = await execRef.current(recordCommand(sub, forDevice));
			if (result.exitCode !== 0) throw new Error(execFailureMessage(result));
			return result.stdout;
		},
		[],
	);

	// Recover a recording that another tab or a terminal started, and clear the
	// indicator when the CLI stops one behind our back. Status failures stay
	// silent: an older CLI without `record` must not toast on every mount.
	const syncStatus = useCallback(
		async (forDevice: string) => {
			try {
				const recording = parseRecordStatus(await run("status", forDevice));
				dispatch(forDevice, { type: "status", recording });
			} catch {
				// Leave the state alone. The next poll or click reports the truth.
			}
		},
		[dispatch, run],
	);

	useEffect(() => {
		setState(IDLE_RECORDING_STATE);
		if (!device) return;
		void syncStatus(device);
	}, [device, syncStatus]);

	const active = isRecordingActive(state);

	useEffect(() => {
		if (!device || !active) return;
		const timer = setInterval(() => {
			void syncStatus(device);
		}, RECORDING_POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [device, active, syncStatus]);

	// Only the elapsed label needs a clock, and only while it is on screen.
	useEffect(() => {
		if (!active) return;
		setNow(Date.now());
		const timer = setInterval(
			() => setNow(Date.now()),
			RECORDING_TICK_INTERVAL_MS,
		);
		return () => clearInterval(timer);
	}, [active]);

	const toggle = useCallback(() => {
		const forDevice = deviceRef.current;
		if (!forDevice) return;
		const current = stateRef.current;
		if (current.status === "idle") {
			dispatch(forDevice, { type: "start" });
			void (async () => {
				try {
					const started = parseRecordStart(await run("start", forDevice));
					dispatch(forDevice, { type: "started", ...started });
				} catch (error) {
					dispatch(forDevice, { type: "failed" });
					notify("error", "Recording did not start", {
						description: errorMessage(error),
					});
				}
			})();
			return;
		}
		if (current.status !== "recording") return;
		dispatch(forDevice, { type: "stop" });
		void (async () => {
			try {
				const stopped = parseRecordStop(await run("stop", forDevice));
				dispatch(forDevice, { type: "stopped" });
				notify("success", stopTitle(stopped), {
					description: stopDescription(stopped),
					action: copyPathAction(stopped.paths),
					duration: 8000,
				});
			} catch (error) {
				dispatch(forDevice, { type: "failed" });
				notify("error", "Recording did not stop", {
					description: errorMessage(error),
				});
			}
		})();
	}, [dispatch, run]);

	return {
		state,
		elapsedMs:
			state.status === "recording" || state.status === "stopping"
				? elapsedSince(state.startedAt, now)
				: null,
		active,
		busy: isRecordingBusy(state),
		toggle,
	};
}
