import { expect, test } from "bun:test";
import {
	renderAppList,
	renderPermissionList,
	renderServerStatus,
	renderWebcamList,
} from "../../../cli/render";
import { renderDeviceLogs } from "../../../cli/device-logs-output";
import { CommandRequestError } from "../../../cli/application-command-client";
import { renderCliError } from "../../../cli/main";
import {
	renderActionResult,
	renderAxNodes,
	renderMatches,
	renderScrollResult,
} from "../../../cli/observe-output";

test("iOS apps render as a table and hide system apps by default", () => {
	const apps = [
		{
			bundleId: "com.example.app",
			name: "Example",
			version: "2.1",
			system: false,
		},
		{
			bundleId: "com.apple.Preferences",
			name: "Settings",
			version: "1.0",
			system: true,
		},
	];
	const user = renderAppList(apps, false);
	expect(user).toBe(
		[
			"APP ID           NAME     VERSION  TYPE",
			"com.example.app  Example  2.1      user",
		].join("\n"),
	);
	expect(user).not.toContain("com.apple.Preferences");
	expect(renderAppList(apps, true)).toBe(
		[
			"APP ID                 NAME      VERSION  TYPE",
			"com.example.app        Example   2.1      user",
			"com.apple.Preferences  Settings  1.0      system",
		].join("\n"),
	);
});

test("Android apps show only the package ID and type", () => {
	const payload = {
		apps: [
			{ package: "com.example.android", system: false },
			{ package: "com.android.settings", system: true },
		],
	};
	expect(renderAppList(payload, false)).toBe(
		["PACKAGE ID           TYPE", "com.example.android  user"].join("\n"),
	);
	expect(renderAppList(payload, true)).toBe(
		[
			"PACKAGE ID            TYPE",
			"com.example.android   user",
			"com.android.settings  system",
		].join("\n"),
	);
});

test("no user apps explains how to see system apps", () => {
	expect(
		renderAppList([{ bundleId: "com.apple.x", system: true }], false),
	).toBe("No user apps installed. Use --all to include system apps.");
});

test("Android runtime permissions render granted and denied", () => {
	const out = renderPermissionList({
		packageName: "com.example",
		runtime: [
			{ permission: "android.permission.CAMERA", granted: true },
			{ permission: "android.permission.RECORD_AUDIO", granted: false },
		],
	});
	expect(out).toContain("android.permission.CAMERA");
	expect(out).toContain("granted");
	expect(out).toContain("denied");
});

test("empty iOS permissions say why instead of printing an empty object", () => {
	const out = renderPermissionList({ bundleId: "not.installed", tcc: {} });
	expect(out).toContain("not.installed");
	expect(out).toContain("may not be installed");
});

test("iOS permission states are readable and preserve unknown values", () => {
	const out = renderPermissionList({
		bundleId: "com.example.app",
		tcc: {
			camera: 2,
			microphone: 0,
			photos: 3,
			kTCCServiceLiverpool: 2,
			kTCCServiceFuture: 9,
		},
		location: { Authorization: 4 },
		notifications: { allowsNotifications: true, critical: true },
	});
	const states = Object.fromEntries(
		out.split("\n").map((line) => line.trim().split(/\s{2,}/, 2)),
	);

	expect(states).toEqual({
		camera: "granted",
		microphone: "denied",
		photos: "limited",
		kTCCServiceLiverpool: "granted",
		kTCCServiceFuture: "unknown (9)",
		location: "always",
		notifications: "critical",
	});
	expect(out).not.toContain("[object Object]");
});

test("unknown structured permission states stay explicit", () => {
	const out = renderPermissionList({
		tcc: { camera: 1 },
		location: { Authorization: 9 },
		notifications: { source: "future" },
	});
	const states = Object.fromEntries(
		out.split("\n").map((line) => line.trim().split(/\s{2,}/, 2)),
	);

	expect(states).toEqual({
		camera: "unknown (1)",
		location: "unknown (9)",
		notifications: 'unknown ({"source":"future"})',
	});
	expect(out).not.toContain("[object Object]");
});

test("a stopped server says how to start it", () => {
	expect(renderServerStatus({ running: false })).toContain(
		"agentsims start --detach",
	);
});

test("a running server reports its url and pid", () => {
	const out = renderServerStatus({
		running: true,
		url: "http://127.0.0.1:3200",
		pid: 42,
		startedAt: "2026-09-15T00:00:00.000Z",
		logFile: "/tmp/x.log",
	});
	expect(out).toContain("http://127.0.0.1:3200");
	expect(out).toContain("42");
});

test("webcams needing a face say so", () => {
	const out = renderWebcamList({
		webcams: [{ id: "cam-1", label: "FaceTime HD" }],
		faceRequired: true,
	});
	expect(out).toContain("cam-1");
	expect(out).toContain("--face front|back");
	expect(renderWebcamList({ webcams: [] })).toBe("No host webcams available.");
});

test.each([
	[
		{
			lines: [{
				id: 7,
				time: "09-06 12:34:56.789",
				pid: 123,
				tid: 456,
				level: "E",
				tag: "ReactNativeJS",
				message: "Request failed",
			}],
		},
		"09-06 12:34:56.789 E ReactNativeJS Request failed",
	],
	[{ lines: [] }, "No device logs."],
])("device logs render compact lines", (payload, expected) => {
	expect(renderDeviceLogs(payload)).toBe(expected);
});

test("command errors keep recovery and uncertain dispatch", () => {
	const error = new CommandRequestError(
		"Device ios-device is no longer available.",
		"unknown",
		"device_gone",
		"DeviceGone",
		{
			device: "ios-device",
			currentDeviceIds: ["other-ios-device"],
			recovery: "Select a current device, then run the command again.",
		},
	);
	expect(renderCliError(error)).toBe([
		"agentsims: device_gone: Device ios-device is no longer available.",
		"device: ios-device",
		"current devices: other-ios-device",
		"recovery: Select a current device, then run the command again.",
		"dispatch=unknown",
		"",
	].join("\n"));
});

test("AX nodes render refs, hierarchy, frames, and raw roles", () => {
	const nodes = [{
		ref: "e1",
		role: "textbox",
		rawRole: "android.widget.EditText",
		label: "Email",
		value: "a@b.co",
		states: ["focused", "clickable"],
		testId: "email",
		box: { x: 10, y: 20, width: 100, height: 40 },
		children: [],
	}];
	expect(renderAxNodes(nodes)).toEqual([
		'- textbox "Email" [ref=e1] [focused] [clickable] [testid=email]: a@b.co',
	]);
	expect(renderAxNodes(nodes, { frames: true, raw: true })).toEqual([
		'- android.widget.EditText "Email" [ref=e1] [focused] [clickable] [box=10,20,100,40] [testid=email]: a@b.co',
	]);
	expect(renderMatches({ device: "device", snapshot: "o1", query: "missing", nodes: [] }))
		.toBe('no node matches "missing" in observation o1');
});

test("AX node text keeps its line breaks visible", () => {
	const nodes = [{
		ref: "e2",
		role: "textbox",
		rawRole: "android.widget.EditText",
		label: "",
		value: "name|note\nLaundry|Urgent.  Reimbursable.\r\nJeans|A need",
		states: [],
		box: { x: 0, y: 0, width: 10, height: 10 },
		children: [],
	}];
	expect(renderAxNodes(nodes)).toEqual([
		"- textbox [ref=e2]: name|note\\nLaundry|Urgent. Reimbursable.\\nJeans|A need",
	]);
});

test.each([
	["suppressed", "The field value did not match."],
	["unknown", "Return dispatch failed."],
])("action output keeps verification and submit %s separate", (status, reason) => {
	const output = renderActionResult({
		device: "ios-device",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "mismatch",
			reason: "The complete value does not match.",
			observed: { expected: "hello", value: "hell" },
		},
		resolved: [{ type: "type", text: "hello", value: "hell" }],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
		text: {
			operation: "type",
			text: "hello",
			expected: "hello",
			value: "hell",
			target: null,
			field: null,
			submit: {
				requested: true,
				status: status as "suppressed" | "unknown",
				reason,
			},
		},
	});
	expect(output).toContain("dispatch  accepted");
	expect(output).toContain("verification  mismatch");
	expect(output).toContain(`submit  ${status}  ${reason}`);
});

test("action output reports the checked transition it observed", () => {
	const output = renderActionResult({
		device: "android:emulator-5554",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "matched",
			reason: "The target changed its checked state.",
			observed: { checked: { before: false, after: true } },
		},
		resolved: [{ type: "tap", from: { x: 0.5, y: 0.5, ref: "e3" } }],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	});
	expect(output).toContain("verification  matched  checked: unchecked → checked");
	expect(output).toContain("The target changed its checked state.");
});

test("action output describes a swipe without judging it", () => {
	const output = renderActionResult({
		device: "android:emulator-5554",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "not_applicable",
			reason: "Observed after the action.",
			observed: {
				contentMoved: true,
				firstVisible: { before: "Autoplay", after: "Autoplay off" },
			},
		},
		resolved: [
			{
				type: "swipe",
				from: { x: 0.5, y: 0.7 },
				to: { x: 0.5, y: 0.3 },
			},
		],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	});
	expect(output).toContain(
		'verification  not_applicable  first: "Autoplay" → "Autoplay off"  contentMoved=yes  Observed after the action.',
	);
});

test("action output names the window a long press opened", () => {
	const output = renderActionResult({
		device: "android:emulator-5554",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "not_applicable",
			reason: "Observed after the action.",
			observed: {
				screenChanged: true,
				foregroundApp: "com.example.app",
				newWindows: ['dialog "Add to playlist" (Cancel, OK)'],
				gone: false,
			},
		},
		resolved: [{ type: "long-press", from: { x: 0.5, y: 0.5, ref: "e3" } }],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	});
	expect(output).toContain(
		'verification  not_applicable  screenChanged=yes  new: dialog "Add to playlist" (Cancel, OK)  Observed after the action.',
	);
});

test("action output marks a target that is gone", () => {
	const output = renderActionResult({
		device: "android:emulator-5554",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "not_applicable",
			reason: "Observed after the action.",
			observed: {
				screenChanged: true,
				foregroundApp: "com.example.app",
				newWindows: [],
				gone: true,
			},
		},
		resolved: [{ type: "tap", from: { x: 0.5, y: 0.5, ref: "e3" } }],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	});
	expect(output).toContain("screenChanged=yes  gone=yes");
});

test("action output names a long press", () => {
	const output = renderActionResult({
		device: "ios-device",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: {
			status: "not_applicable",
			reason: "This action has no direct value check.",
		},
		resolved: [{ type: "long-press", from: { x: 0.25, y: 0.75 } }],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	});
	expect(output).toContain("action  long-press 25.0%,75.0%");
});

test("a watched action prints its sheets, its kept frames, and its warnings", () => {
	const output = renderActionResult(
		{
			device: "android:emulator-5554",
			dispatch: { status: "accepted", reason: "Input frames were accepted." },
			verification: {
				status: "not_applicable",
				reason: "Observed after the action.",
				observed: null,
			},
			resolved: [{ type: "tap", from: { x: 0.5, y: 0.5, ref: "e3" } }],
			accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
			view: null,
			image: null,
			captureReason: null,
			warnings: [],
			watch: {
				frames: [
					{
						index: 0,
						atMs: 0,
						width: 40,
						height: 90,
						source: "screenshot" as const,
					},
					{
						index: 1,
						atMs: 260,
						width: 40,
						height: 90,
						source: "screenshot" as const,
						png: new Uint8Array(4),
					},
				],
				sheets: [
					{
						index: 0,
						frames: [0, 1],
						png: new Uint8Array(8),
						columns: 2,
						rows: 1,
						cellWidth: 40,
						cellHeight: 90,
						width: 80,
						height: 90,
					},
				],
				requestedIntervalMs: 250,
				achievedIntervalMs: 260,
				warnings: ["Frames arrived every 260 ms, not every 250 ms."],
			},
		},
		null,
		{},
		{
			sheets: [{ status: "ok", path: "/tmp/action-sheet.png" }],
			frames: [null, { status: "ok", path: "/tmp/action-frame-1.png" }],
		},
	);
	expect(output).toContain(
		"watch  2 frames  source=screenshot  every=250ms  achieved=260ms  size=40×90",
	);
	expect(output).toContain(
		"sheet  0  frames=0–1  grid=2x1  cell=40x90  path=/tmp/action-sheet.png",
	);
	expect(output).toContain("frame  1  at=260ms  path=/tmp/action-frame-1.png");
	expect(output).not.toContain("frame  0  at=");
	expect(output).toContain("warning  Frames arrived every 260 ms");
});

test("scroll output names the region, the travel, and the collected items", () => {
	const output = renderScrollResult({
		device: "android:emulator-5554",
		direction: "down",
		container: {
			ref: "e14",
			role: "list",
			label: "RecyclerView",
			path: "0.1",
			box: { x: 0, y: 1000, width: 1080, height: 1000 },
			source: "scrollable",
		},
		from: { x: 540, y: 1700 },
		to: { x: 540, y: 1300 },
		amount: 40,
		durationMs: 600,
		swipes: 3,
		pages: 3,
		endReached: true,
		selector: "cell",
		count: 2,
		items: [
			{ ref: "e20", role: "cell", label: "Buy milk", value: "", text: "Buy milk" },
			{
				ref: "e21",
				role: "cell",
				label: "",
				value: "",
				testId: "task-2",
				text: "Pay rent",
			},
		],
		action: {
			device: "android:emulator-5554",
			dispatch: { status: "accepted", reason: "Input frames were accepted." },
			verification: {
				status: "not_applicable",
				reason: "This action has no direct value check.",
			},
			resolved: [
				{ type: "swipe", from: { x: 0.5, y: 0.7 }, to: { x: 0.5, y: 0.3 } },
			],
			accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
			view: null,
			image: null,
			captureReason: null,
			warnings: [],
		},
	});
	const lines = output.split("\n");
	expect(lines[0]).toBe(
		'action  scroll down in list "RecyclerView" @e14  from 540,1700 to 540,1300 px  amount=40%  duration=600ms  pages=3  endReached=yes',
	);
	expect(lines[1]).toBe("dispatch  accepted  Input frames were accepted.");
	expect(lines[2]).toContain("verification  not_applicable");
	// The swipe is reported once, by the scroll line.
	expect(output).not.toContain("action  swipe");
	expect(output).toContain("collected  2 items  selector=cell");
	expect(output).toContain('  cell "Buy milk" [ref=e20]');
	expect(output).toContain('  cell "Pay rent" [ref=e21] [testid=task-2]');
});
