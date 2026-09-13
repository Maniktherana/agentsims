import { expect, test } from "bun:test";
import { hostPlatformInfo } from "../../../../core/host";

test("Linux and WSL expose Android without Apple capabilities", () => {
	expect(hostPlatformInfo("linux")).toEqual({
		platform: "linux",
		platforms: ["android"],
		iosSimulator: false,
		nativeAndroidVideo: true,
		hostAudio: false,
		webkit: false,
	});
});

test("macOS supports both platforms while native Windows is not advertised", () => {
	expect(hostPlatformInfo("darwin").platforms).toEqual(["android", "ios"]);
	expect(hostPlatformInfo("win32").platforms).toEqual([]);
});
