import {
	readInjectedBundles,
	locateCameraHelper,
	buildCameraHelper,
	sendHelperCommand,
	attachCamera,
	isHelperAlive,
	stopExistingHelper,
	currentHelperPid,
} from "./camera-helper";
import { axFrontmostAsync } from "./stream/native";
import { hostCommandText } from "../host";
import type { HostAudioDevice } from "./host-audio";

export type IosCameraSource = "placeholder" | "webcam" | "image" | "video";

export interface IosCameraStatus {
	alive: boolean;
	source?: string;
	arg?: string;
	mirror?: "on" | "off";
	helperPid?: number;
	bundleIds: string[];
}

const NON_UI_BUNDLE_RE =
	/(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.springboard|com\.apple\.SpringBoard|com\.android\.|com\.google\.)/i;

function isUserFacingBundle(bundleId: string): boolean {
	return !bundleId.startsWith("com.apple.") && !NON_UI_BUNDLE_RE.test(bundleId);
}

export async function getIosCameraStatus(
	udid: string,
): Promise<IosCameraStatus> {
	if (!isHelperAlive(udid)) {
		return { alive: false, bundleIds: [] };
	}
	const reply: Awaited<ReturnType<typeof sendHelperCommand>> & {
		mirror?: unknown;
	} = await sendHelperCommand(udid, { action: "status" });
	return {
		alive: reply.ok === true,
		source: typeof reply.source === "string" ? reply.source : undefined,
		arg: typeof reply.arg === "string" ? reply.arg : undefined,
		mirror:
			reply.mirror === "on" || reply.mirror === "off" ? reply.mirror : undefined,
		helperPid: currentHelperPid(udid) ?? undefined,
		bundleIds: readInjectedBundles(udid),
	};
}

export async function setIosCameraMirror(
	udid: string,
	mirror: "on" | "off",
): Promise<void> {
	if (!isHelperAlive(udid))
		throw new Error("iOS camera helper is not attached to an app");
	const reply = await sendHelperCommand(udid, {
		action: "setMirror",
		mode: mirror,
	});
	if (reply.ok !== true) {
		throw new Error(
			typeof reply.error === "string"
				? reply.error
				: "Camera helper did not change the mirror mode",
		);
	}
}

export async function switchIosCameraSource(
	udid: string,
	source: IosCameraSource,
	arg?: string,
): Promise<void> {
	if (!isHelperAlive(udid))
		throw new Error("iOS camera helper is not attached to an app");
	const reply = await sendHelperCommand(udid, {
		action: "switch",
		source,
		...(arg ? { arg } : {}),
	});
	if (reply.ok !== true) {
		throw new Error(
			typeof reply.error === "string"
				? reply.error
				: "camera helper rejected switch",
		);
	}
}

export async function findFrontmostIosAppBundle(udid: string): Promise<string> {
	const info = JSON.parse(await axFrontmostAsync(udid)) as {
		bundleId?: string;
	};
	if (!info.bundleId || !isUserFacingBundle(info.bundleId)) {
		throw new Error(
			"Open the app you want to attach camera routing to, then try again",
		);
	}
	return info.bundleId;
}

interface IosCameraSourceHost {
	getStatus: typeof getIosCameraStatus;
	findFrontmost: typeof findFrontmostIosAppBundle;
	switchSource: typeof switchIosCameraSource;
	attach: (options: Parameters<typeof attachCamera>[0]) => Promise<unknown>;
}

const iosCameraSourceHost: IosCameraSourceHost = {
	getStatus: getIosCameraStatus,
	findFrontmost: findFrontmostIosAppBundle,
	switchSource: switchIosCameraSource,
	attach: attachCamera,
};

export async function attachOrSwitchIosCameraSource(
	udid: string,
	source: IosCameraSource,
	arg?: string,
	targetBundleId?: string,
	host = iosCameraSourceHost,
): Promise<"live" | "app-relaunch"> {
	if ((source === "image" || source === "video") && !arg)
		throw new Error(`${source} camera source requires a file path`);
	const status = await host.getStatus(udid).catch((): IosCameraStatus => ({
		alive: false,
		bundleIds: [],
	}));
	if (
		status.alive &&
		(targetBundleId
			? status.bundleIds.includes(targetBundleId)
			: status.bundleIds.length > 0)
	) {
		await host.switchSource(udid, source, arg);
		return "live";
	}
	const bundleId = targetBundleId ?? (await host.findFrontmost(udid));
	await host.attach({
		signal: AbortSignal.timeout(30_000),
		udid,
		bundleId,
		...(source === "webcam"
			? { webcam: arg || true }
			: source === "image" || source === "video"
				? { file: arg }
				: {}),
	});
	return "app-relaunch";
}

export async function listIosWebcams(): Promise<HostAudioDevice[]> {
	if (process.platform !== "darwin") return [];
	const stdout = await hostCommandText(
		locateCameraHelper() ?? (await buildCameraHelper()),
		"--list",
	);
	return stdout.split(/\r?\n/).flatMap((line) => {
		const [id, label] = line.split("\t");
		return id && label ? [{ id, label }] : [];
	});
}

/** Stops only the camera helper recorded for this simulator by Agentsims. */
export async function stopIosCameraInjection(udid: string): Promise<void> {
	await stopExistingHelper(udid);
}
