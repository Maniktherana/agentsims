import { expect, test } from "bun:test";
import {
	renderAppList,
	renderPermissionList,
	renderServerStatus,
	renderWebcamList,
} from "../../../cli/render";

test("iOS apps render as a table and hide system apps by default", () => {
	const apps = [
		{ bundleId: "com.example.app", name: "Example", version: "2.1", system: false },
		{ bundleId: "com.apple.Preferences", name: "Settings", version: "1.0", system: true },
	];
	const user = renderAppList(apps, false);
	expect(user).toContain("com.example.app");
	expect(user).not.toContain("com.apple.Preferences");
	expect(renderAppList(apps, true)).toContain("com.apple.Preferences");
});

test("Android's {apps:[{package,system}]} shape renders through the same path", () => {
	const payload = { apps: [{ package: "com.example.android", system: false }] };
	const out = renderAppList(payload, false);
	expect(out).toContain("com.example.android");
	expect(out).toContain("user");
});

test("no user apps explains how to see system apps", () => {
	expect(renderAppList([{ bundleId: "com.apple.x", system: true }], false)).toBe(
		"No user apps installed. Use --all to include system apps.",
	);
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
