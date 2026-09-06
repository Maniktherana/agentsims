/** Describe host platform support without probing installed tools or devices. */
export function hostPlatformInfo(platform: NodeJS.Platform = process.platform) {
	const apple = platform === "darwin";
	const android = apple || platform === "linux";
	return {
		platform,
		platforms: apple ? ["android", "ios"] : android ? ["android"] : [],
		iosSimulator: apple,
		nativeAndroidVideo: android,
		hostAudio: apple,
		webkit: apple,
	};
}
