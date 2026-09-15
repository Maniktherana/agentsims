import { expect, test } from "bun:test";
import { attachCamera } from "../../../../core/ios/camera-helper";
import {
	attachOrSwitchIosCameraSource,
	type IosCameraStatus,
} from "../../../../core/ios/camera";
function host(relaunched = true) {
	const calls: string[] = [];
	let environment: NodeJS.ProcessEnv = {};
	return {
		calls,
		get environment() {
			return environment;
		},
		locateDylib: () => "/camera.dylib",
		buildDylib: async () => "/built.dylib",
		ensureHelper: async (options: {
			source: { kind: string; arg?: string };
		}) => {
			calls.push(`helper:${options.source.kind}:${options.source.arg ?? ""}`);
			return { helperPid: 123, shmName: "/camera-shm", relaunched };
		},
		send: async (_udid: string, command: object) => {
			calls.push(JSON.stringify(command));
			return { ok: true };
		},
		command: async (
			_signal: AbortSignal | undefined,
			...args: [string, ...string[]]
		) => {
			calls.push(args.join(" "));
			return "";
		},
		launch: async (_udid: string, _bundle: string, env: NodeJS.ProcessEnv) => {
			calls.push("launch");
			environment = env;
			return "com.example.app: 456\n";
		},
		record: (udid: string, bundle: string, pid: number) => {
			calls.push(`record:${udid}:${bundle}:${pid}`);
		},
	};
}
test("camera attachment preserves injection environment and CLI result", async () => {
	const system = host();
	const result = await attachCamera(
		{
			udid: "test",
			bundleId: "com.example.app",
			webcam: "Front",
			mirror: "off",
		},
		system,
	);
	expect(result).toEqual({
		udid: "test",
		bundleId: "com.example.app",
		pid: 456,
		dylib: "/camera.dylib",
		source: "webcam",
		arg: "Front",
		shm: "/camera-shm",
		helperPid: 123,
		mirror: "off",
		hotSwapped: false,
		helperRelaunched: true,
	});
	expect(system.environment.SIMCTL_CHILD_DYLD_INSERT_LIBRARIES).toBe(
		"/camera.dylib",
	);
	expect(system.environment.SIMCTL_CHILD_SIMCAM_SHM_NAME).toBe("/camera-shm");
	expect(system.environment.SIMCTL_CHILD_SIMCAM_MIRROR_MODE).toBe("off");
	expect(system.calls).toEqual([
		"helper:webcam:Front",
		'{"action":"setMirror","mode":"off"}',
		"xcrun simctl privacy test grant camera com.example.app",
		"xcrun simctl terminate test com.example.app",
		"launch",
		"record:test:com.example.app:123",
	]);
});
test("existing helper still relaunches the app and resets automatic mirror", async () => {
	const system = host(false);
	const result = await attachCamera(
		{ udid: "test", bundleId: "com.example.app" },
		system,
	);
	expect(result.helperRelaunched).toBe(false);
	expect(system.calls).toContain('{"action":"setMirror","mode":"auto"}');
	expect(system.calls).toContain("launch");
});
test("invalid sources and canceled attachment do not start helpers", async () => {
	const system = host();
	await expect(
		attachCamera(
			{ udid: "test", bundleId: "app", file: "missing", webcam: true },
			system,
		),
	).rejects.toThrow("Pick one source: --file or --webcam, not both.");
	await expect(
		attachCamera(
			{ udid: "test", bundleId: "app", signal: AbortSignal.abort() },
			system,
		),
	).rejects.toThrow();
	expect(system.calls).toEqual([]);
});

function cameraSourceHost(status: IosCameraStatus) {
	const calls: unknown[] = [];
	return {
		calls,
		getStatus: async () => status,
		findFrontmost: async () => {
			calls.push("frontmost");
			return "com.example.frontmost";
		},
		switchSource: async (...args: unknown[]) => {
			calls.push({ switch: args });
		},
		attach: async (options: Parameters<typeof attachCamera>[0]) => {
			calls.push({ attach: options });
		},
	};
}

test("source routing attaches a new target app even when another app shares the helper", async () => {
	const system = cameraSourceHost({
		alive: true,
		bundleIds: ["com.example.other"],
	});
	expect(
		await attachOrSwitchIosCameraSource(
			"simulator", "webcam", "camera-1", "com.example.target", system,
		),
	).toBe("app-relaunch");
	expect(system.calls).toEqual([
		{
			attach: {
				udid: "simulator",
				bundleId: "com.example.target",
				webcam: "camera-1",
				signal: expect.any(AbortSignal),
			},
		},
	]);
});

test("source routing switches attached targets without relaunching them", async () => {
	for (const target of [undefined, "com.example.target"]) {
		const system = cameraSourceHost({
			alive: true,
			bundleIds: ["com.example.target"],
		});
		expect(
			await attachOrSwitchIosCameraSource(
				"simulator", "image", "/tmp/camera.png", target, system,
			),
		).toBe("live");
		expect(system.calls).toEqual([
			{ switch: ["simulator", "image", "/tmp/camera.png"] },
		]);
	}
});

test("source routing still selects the foreground app when no target is supplied", async () => {
	const system = cameraSourceHost({ alive: false, bundleIds: [] });
	expect(
		await attachOrSwitchIosCameraSource(
			"simulator", "placeholder", undefined, undefined, system,
		),
	).toBe("app-relaunch");
	expect(system.calls).toEqual([
		"frontmost",
		{
			attach: {
				udid: "simulator",
				bundleId: "com.example.frontmost",
				signal: expect.any(AbortSignal),
			},
		},
	]);
});
