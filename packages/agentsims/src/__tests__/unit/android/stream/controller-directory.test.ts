import { expect, test } from "bun:test";
import { linuxControllerDirectory } from "../../../../android/stream/emulator-controller";

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
