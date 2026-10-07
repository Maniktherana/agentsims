import { expect, test } from "bun:test";
import { hostPlatformInfo } from "../../../../core/host";

test.each(["linux", "win32"] as const)("%s exposes Android without Apple capabilities", (platform) => {
	expect(hostPlatformInfo(platform)).toEqual({
		platform,
		platforms: ["android"],
		iosSimulator: false,
		nativeAndroidVideo: true,
		hostAudio: false,
		webkit: false,
	});
});

test("macOS supports both platforms while other hosts remain unavailable", () => {
	expect(hostPlatformInfo("darwin").platforms).toEqual(["android", "ios"]);
	expect(hostPlatformInfo("freebsd").platforms).toEqual([]);
});
