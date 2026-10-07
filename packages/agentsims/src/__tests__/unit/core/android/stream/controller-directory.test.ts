import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	AndroidEmulatorControllerUnavailableError,
	controllerMetadata,
	emulatorControllerDirectory,
	linuxControllerDirectory,
} from "../../../../../core/android/stream/emulator-controller";

test("a missing controller directory produces a useful transport error", () => {
	expect(() =>
		controllerMetadata(
			"emulator-5554",
			"/directory-that-does-not-exist/avd/running",
		),
	).toThrow(AndroidEmulatorControllerUnavailableError);
	expect(() =>
		controllerMetadata(
			"emulator-5554",
			"/directory-that-does-not-exist/avd/running",
		),
	).toThrow(
		"Native Android streaming cannot authenticate emulator-5554. Restart the emulator to recreate its controller credentials. Expected metadata in /directory-that-does-not-exist/avd/running",
	);
});

test("Linux and WSL use XDG discovery even before the directory exists", () => {
	expect(
		linuxControllerDirectory(
			{ XDG_RUNTIME_DIR: "/run/user/1000", WSL_DISTRO_NAME: "Ubuntu" },
			() => false,
		),
	).toBe("/run/user/1000/avd/running");
});

test("Linux checks the system user runtime directory before emulator home", () => {
	const runtime = `/run/user/${process.getuid?.()}`;
	expect(
		linuxControllerDirectory(
			{ ANDROID_EMULATOR_HOME: "/custom" },
			(path) => path === runtime,
		),
	).toBe(`${runtime}/avd/running`);
});

test("Linux falls back to emulator, preferences, SDK and home directories", () => {
	expect(
		linuxControllerDirectory(
			{ ANDROID_EMULATOR_HOME: "/emulator", ANDROID_PREFS_ROOT: "/prefs" },
			() => false,
		),
	).toBe("/emulator/avd/running");
	expect(
		linuxControllerDirectory(
			{ ANDROID_PREFS_ROOT: "/prefs", ANDROID_SDK_HOME: "/sdk" },
			(path) => path === "/prefs/.android",
		),
	).toBe("/prefs/.android/avd/running");
	expect(
		linuxControllerDirectory({ ANDROID_PREFS_ROOT: "/prefs" }, () => false),
	).toBe("/prefs/avd/running");
	expect(
		linuxControllerDirectory({ ANDROID_SDK_HOME: "/sdk" }, () => false),
	).toBe("/sdk/avd/running");
	expect(
		linuxControllerDirectory(
			{ HOME: "/home/test", XDG_RUNTIME_DIR: "" },
			() => false,
		),
	).toBe("/home/test/.android/avd/running");
});

test("Windows uses Android LOCALAPPDATA discovery rather than TEMP or the Mac directory", () => {
	expect(
		emulatorControllerDirectory({
			platform: "win32",
			env: {
				LocalAppData: "C:\\Users\\Test User\\AppData\\Local",
				TEMP: "D:\\Other Temp",
				ANDROID_EMULATOR_HOME: "D:\\Emulator",
			},
			homeDirectory: "C:\\Users\\Test User",
		}),
	).toBe("C:\\Users\\Test User\\AppData\\Local\\Temp\\avd\\running");
});

test("Windows discovery falls back to Android user-directory preferences", () => {
	const options = {
		platform: "win32" as const,
		homeDirectory: "C:\\Users\\test",
		isDirectory: (path: string) => path === "D:\\Prefs\\.android",
	};
	expect(
		emulatorControllerDirectory({
			...options,
			env: { android_emulator_home: "D:\\Emulator", ANDROID_PREFS_ROOT: "D:\\Prefs" },
		}),
	).toBe("D:\\Emulator\\avd\\running");
	expect(
		emulatorControllerDirectory({ ...options, env: { ANDROID_PREFS_ROOT: "D:\\Prefs" } }),
	).toBe("D:\\Prefs\\.android\\avd\\running");
	expect(
		emulatorControllerDirectory({ ...options, env: { ANDROID_SDK_HOME: "D:\\SDK" } }),
	).toBe("D:\\SDK\\avd\\running");
	expect(emulatorControllerDirectory({ ...options, env: {} })).toBe(
		"C:\\Users\\test\\.android\\avd\\running",
	);
});

test("the shared directory selector preserves Mac and Linux paths", () => {
	expect(
		emulatorControllerDirectory({
			platform: "darwin",
			homeDirectory: "/Users/test",
			env: {},
		}),
	).toBe("/Users/test/Library/Caches/TemporaryItems/avd/running");
	expect(
		emulatorControllerDirectory({
			platform: "linux",
			env: { XDG_RUNTIME_DIR: "/run/user/1000" },
		}),
	).toBe("/run/user/1000/avd/running");
});

test("controller credentials support Windows line endings and isolate emulator serials", () => {
	const directory = mkdtempSync(join(tmpdir(), "agentsims-controller-directory-"));
	try {
		writeFileSync(join(directory, "pid_10.ini"), "port.serial=5554\r\ngrpc.port=0\r\n");
		writeFileSync(
			join(directory, "pid_11.ini"),
			"port.serial=5554\r\ngrpc.port=8554\r\ngrpc.token=first-token\r\n",
		);
		writeFileSync(
			join(directory, "pid_12.ini"),
			"port.serial=5556\r\ngrpc.port=8556\r\ngrpc.token=second-token\r\n",
		);
		expect(controllerMetadata("emulator-5554", directory)).toEqual({
			pid: 11, port: 8554, token: "first-token",
		});
		expect(controllerMetadata("emulator-5556", directory)).toEqual({
			pid: 12, port: 8556, token: "second-token",
		});
		expect(() => controllerMetadata("emulator-5558", directory)).toThrow(
			AndroidEmulatorControllerUnavailableError,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
