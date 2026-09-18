import { describe, expect, test } from "bun:test";
import {
	IDLE_RECORDING_STATE,
	elapsedSince,
	execFailureMessage,
	formatBytes,
	formatElapsed,
	isRecordingActive,
	isRecordingBusy,
	parseRecordStart,
	parseRecordStatus,
	parseRecordStop,
	recordCommand,
	screenRecordingReducer,
	stopDescription,
	stopTitle,
	type ScreenRecordingAction,
	type ScreenRecordingState,
} from "../../../../../web/hooks/simulator/use-screen-recording";

const RECORDING: ScreenRecordingState = {
	status: "recording",
	path: "/tmp/agentsims/recordings/a.mp4",
	startedAt: "2026-09-19T10:00:00.000Z",
};

function run(
	state: ScreenRecordingState,
	...actions: ScreenRecordingAction[]
): ScreenRecordingState {
	return actions.reduce(screenRecordingReducer, state);
}

describe("recordCommand", () => {
	test("asks the CLI for JSON and quotes the device id", () => {
		expect(recordCommand("start", "android:emulator-5556")).toBe(
			"agentsims record start -d 'android:emulator-5556' --json",
		);
		expect(recordCommand("status", "UDID")).toBe(
			"agentsims record status -d 'UDID' --json",
		);
	});
});

describe("screenRecordingReducer", () => {
	test("start then started reaches recording with the reported path", () => {
		const state = run(
			IDLE_RECORDING_STATE,
			{ type: "start" },
			{
				type: "started",
				path: "/tmp/a.mp4",
				startedAt: "2026-09-19T10:00:00.000Z",
			},
		);
		expect(state).toEqual({
			status: "recording",
			path: "/tmp/a.mp4",
			startedAt: "2026-09-19T10:00:00.000Z",
		});
	});

	test("stop then stopped returns to idle", () => {
		expect(run(RECORDING, { type: "stop" }, { type: "stopped" })).toEqual(
			IDLE_RECORDING_STATE,
		);
	});

	test("a failed start returns to idle", () => {
		expect(
			run(IDLE_RECORDING_STATE, { type: "start" }, { type: "failed" }),
		).toEqual(IDLE_RECORDING_STATE);
	});

	// A stop that the CLI refuses must not lose the indicator: the device is
	// still recording.
	test("a failed stop keeps the recording it tried to stop", () => {
		expect(run(RECORDING, { type: "stop" }, { type: "failed" })).toEqual(
			RECORDING,
		);
	});

	test("a second click while a request runs changes nothing", () => {
		const starting = run(IDLE_RECORDING_STATE, { type: "start" });
		expect(run(starting, { type: "start" })).toBe(starting);
		const stopping = run(RECORDING, { type: "stop" });
		expect(run(stopping, { type: "stop" })).toBe(stopping);
	});

	test("status recovers a recording that the CLI already runs", () => {
		expect(
			run(IDLE_RECORDING_STATE, {
				type: "status",
				recording: { path: "/tmp/b.mp4", startedAt: "2026-09-19T09:00:00Z" },
			}),
		).toEqual({
			status: "recording",
			path: "/tmp/b.mp4",
			startedAt: "2026-09-19T09:00:00Z",
		});
	});

	test("status clears the indicator after the CLI stops the recording", () => {
		expect(run(RECORDING, { type: "status", recording: null })).toEqual(
			IDLE_RECORDING_STATE,
		);
	});

	test("status does not disturb a request in flight", () => {
		const starting = run(IDLE_RECORDING_STATE, { type: "start" });
		expect(run(starting, { type: "status", recording: null })).toBe(starting);
		const stopping = run(RECORDING, { type: "stop" });
		expect(
			run(stopping, {
				type: "status",
				recording: { path: "/tmp/c.mp4", startedAt: "2026-09-19T09:00:00Z" },
			}),
		).toBe(stopping);
	});

	test("status keeps the same object when nothing changed", () => {
		expect(
			run(RECORDING, {
				type: "status",
				recording: { path: RECORDING.path, startedAt: RECORDING.startedAt },
			}),
		).toBe(RECORDING);
	});

	test("a device change resets the button", () => {
		expect(run(RECORDING, { type: "reset" })).toEqual(IDLE_RECORDING_STATE);
		expect(run(IDLE_RECORDING_STATE, { type: "reset" })).toBe(
			IDLE_RECORDING_STATE,
		);
	});

	test("busy and active report the button state", () => {
		expect(isRecordingBusy({ status: "starting" })).toBe(true);
		expect(isRecordingBusy(RECORDING)).toBe(false);
		expect(isRecordingActive(RECORDING)).toBe(true);
		expect(isRecordingActive({ status: "stopping", ...RECORDING })).toBe(true);
		expect(isRecordingActive(IDLE_RECORDING_STATE)).toBe(false);
	});
});

describe("parseRecordStart", () => {
	test("reads the path and start time", () => {
		expect(
			parseRecordStart(
				'{"device":"UDID","path":"/tmp/a.mp4","startedAt":"2026-09-19T10:00:00.000Z"}',
			),
		).toEqual({
			path: "/tmp/a.mp4",
			startedAt: "2026-09-19T10:00:00.000Z",
		});
	});

	test("ignores lines around the JSON object", () => {
		expect(
			parseRecordStart(
				'warning: something\n{"path":"/tmp/a.mp4","startedAt":"T"}\n',
			).path,
		).toBe("/tmp/a.mp4");
	});

	test("rejects output without the expected fields", () => {
		expect(() => parseRecordStart('{"device":"UDID"}')).toThrow("path");
		expect(() => parseRecordStart("not json")).toThrow("no JSON");
	});
});

describe("parseRecordStop", () => {
	test("reads every segment path and the totals", () => {
		expect(
			parseRecordStop(
				'{"device":"UDID","paths":["/tmp/a.mp4","/tmp/a-2.mp4"],"frames":312,"durationMs":10400,"bytes":2097152,"startedAt":"T","endedAt":"T"}',
			),
		).toEqual({
			paths: ["/tmp/a.mp4", "/tmp/a-2.mp4"],
			frames: 312,
			durationMs: 10400,
			bytes: 2097152,
		});
	});

	test("treats missing counters as zero", () => {
		expect(parseRecordStop('{"paths":["/tmp/a.mp4"]}').frames).toBe(0);
	});

	test("rejects a stop that wrote no file", () => {
		expect(() => parseRecordStop('{"paths":[]}')).toThrow("no recording file");
		expect(() => parseRecordStop('{"path":"/tmp/a.mp4"}')).toThrow("paths");
	});
});

describe("parseRecordStatus", () => {
	test("reports an active recording", () => {
		expect(
			parseRecordStatus(
				'{"device":"UDID","recording":{"path":"/tmp/a.mp4","startedAt":"T","frames":10,"bytes":100}}',
			),
		).toEqual({ path: "/tmp/a.mp4", startedAt: "T" });
	});

	test("reports no recording", () => {
		expect(parseRecordStatus('{"device":"UDID","recording":null}')).toBeNull();
		expect(parseRecordStatus('{"device":"UDID"}')).toBeNull();
	});
});

describe("execFailureMessage", () => {
	test("strips the CLI prefix from the error line", () => {
		expect(
			execFailureMessage({
				stdout: "",
				stderr: "agentsims: device UDID is already recording\n",
				exitCode: 1,
			}),
		).toBe("device UDID is already recording");
	});

	test("falls back to stdout, then to the exit code", () => {
		expect(
			execFailureMessage({
				stdout: "no such command",
				stderr: "",
				exitCode: 1,
			}),
		).toBe("no such command");
		expect(execFailureMessage({ stdout: "", stderr: "", exitCode: 127 })).toBe(
			"Command exited with code 127",
		);
	});
});

describe("elapsed time", () => {
	test("counts from the reported start time", () => {
		const started = "2026-09-19T10:00:00.000Z";
		expect(elapsedSince(started, Date.parse(started) + 5_000)).toBe(5_000);
		expect(elapsedSince(started, Date.parse(started) - 5_000)).toBe(0);
		expect(elapsedSince("not a date", Date.now())).toBe(0);
	});

	test("formats as m:ss and grows to h:mm:ss", () => {
		expect(formatElapsed(0)).toBe("0:00");
		expect(formatElapsed(9_400)).toBe("0:09");
		expect(formatElapsed(65_000)).toBe("1:05");
		expect(formatElapsed(600_000)).toBe("10:00");
		expect(formatElapsed(3_725_000)).toBe("1:02:05");
	});
});

describe("stop toast", () => {
	const result = {
		paths: ["/tmp/a.mp4"],
		frames: 300,
		durationMs: 10_000,
		bytes: 2_097_152,
	};

	test("titles the toast with the recording facts", () => {
		expect(stopTitle(result)).toBe(
			"Recording saved · 0:10 · 300 frames · 2.0 MB",
		);
	});

	test("shows the path, and counts the extra segments", () => {
		expect(stopDescription(result)).toBe("/tmp/a.mp4");
		expect(
			stopDescription({ ...result, paths: ["/tmp/a.mp4", "/tmp/a-2.mp4"] }),
		).toBe("/tmp/a.mp4 +1 more");
	});

	test("formats small files in KB", () => {
		expect(formatBytes(4096)).toBe("4 KB");
		expect(formatBytes(0)).toBe("0 MB");
	});
});
