// Apple unified-log families used by mobile-dev's default noise filter.
// Match native metadata before Default and Info become the same public severity.
const debugSubsystems = new Set(["com.apple.uikit", "com.apple.cfbundle"]);
const routineSubsystems = new Set([
	"com.apple.network",
	"com.apple.cfnetwork",
	"com.apple.pointerui",
	"com.apple.backboard",
	"com.apple.xpc",
	"com.apple.backlightservices",
	"com.apple.baseboard",
	"com.apple.frontboard",
	"com.apple.runningboard",
	"com.apple.uiintelligencesupport",
	"com.apple.securityd",
	"com.apple.containermanager",
	"com.apple.fileurl",
	"com.apple.dt.xctest",
	"com.apple.accessibility",
	"com.apple.boardservices",
	"com.apple.systemconfiguration",
	"com.apple.coreaudio",
	"com.apple.launchservices",
	"com.apple.apsd",
	"com.apple.symptomsd",
	"com.apple.remoteservicediscovery",
	"com.apple.locationd",
	"com.apple.mdnsresponder",
	"com.apple.xnu.net",
	"com.apple.dt.coredevice",
	"com.apple.wifimanager",
	"com.apple.bluetooth",
	"com.apple.uaps",
	"com.apple.corebrightness",
	"com.apple.wirelessradiomanager",
	"com.apple.wifipolicy",
]);
const debugImages = [
	"UIKitCore.framework/UIKitCore",
	"CoreFoundation.framework/CoreFoundation",
	"lib/libMobileGestalt.dylib",
	"libsystem_containermanager.dylib",
	"CoreAnalytics.framework/CoreAnalytics",
];
const routineImages = ["RunningBoardServices", "Security.framework/Security"];

/** Keep app messages, warnings, errors, and unrecognized native severities. */
export function isRoutineIosLog(
	nativeLevel: unknown,
	subsystem: unknown,
	senderImagePath: unknown,
): boolean {
	if (typeof nativeLevel !== "string") return false;
	const severity = nativeLevel.toLowerCase();
	const debug =
		severity === "debug" || severity === "default" || severity === "notice";
	if (!debug && severity !== "info") return false;
	if (typeof subsystem === "string") {
		let family = subsystem.toLowerCase();
		while (family) {
			if (
				routineSubsystems.has(family) ||
				(debug && debugSubsystems.has(family))
			)
				return true;
			const separator = family.lastIndexOf(".");
			if (separator < 0) break;
			family = family.slice(0, separator);
		}
	}
	return (
		typeof senderImagePath === "string" &&
		(routineImages.some((path) => senderImagePath.includes(path)) ||
			(debug && debugImages.some((path) => senderImagePath.includes(path))))
	);
}
