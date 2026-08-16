import {
	androidAvdStateId,
	androidSerialFromStateId,
	getAndroidStatus,
	listAndroidDevices,
	listAndroidWebcams,
	setAndroidHostMicrophone,
	setAndroidMediaVolume,
	setAndroidMediaVolumeLevel,
	setAndroidVirtualSceneImage,
	validateAndroidCameraStartupMode,
	type AndroidWebcam,
} from "../../android/device/device";
import type { AndroidStatus } from "../../android/device/types";
import { deviceLifecycle } from "../devices/device-lifecycle";
import type {
	DeviceMediaState,
	MediaApplyMode,
	MediaRouteAction,
	MediaRouteResult,
	MediaSourceChoice,
} from "./model";
import {
	emptyHostAudioSnapshot,
	hostAudioLabel,
	listHostAudioDevices,
	setHostDefaultInput,
	setHostDefaultOutput,
	setHostOutputVolume,
	type HostAudioSnapshot,
} from "./host-audio";
import {
	attachOrSwitchIosCameraSource,
	getIosCameraStatus,
	listIosWebcams,
	type IosCameraStatus,
} from "./ios-camera";
import {
	getStoredMediaRoute,
	updateStoredMediaRoute,
	type StoredMediaRoute,
} from "./route-store";

const microphoneRoutes = new Map<string, boolean>();

export function mediaDeviceFromRequestUrl(
	rawUrl: string | undefined,
): string | null {
	try {
		const device = new URL(
			rawUrl ?? "",
			"http://agentsims.local",
		).searchParams.get("device");
		return device && device.length > 0 ? device : null;
	} catch {
		return null;
	}
}

function webcamChoices(webcams: AndroidWebcam[]): MediaSourceChoice[] {
	return webcams.map((webcam) => ({
		id: webcam.id,
		label: webcam.name,
		apply: "device-restart" as const,
		scope: "device" as const,
	}));
}

function hostInputChoices(hostAudio: HostAudioSnapshot): MediaSourceChoice[] {
	return hostAudio.input.map((device) => ({
		id: device.id,
		label: device.label,
		apply: "live" as const,
		scope: "host-global" as const,
	}));
}

function hostOutputChoices(hostAudio: HostAudioSnapshot): MediaSourceChoice[] {
	return hostAudio.output.map((device) => ({
		id: device.id,
		label: device.label,
		apply: "live" as const,
		scope: "host-global" as const,
	}));
}

function actualInputFor(hostAudio: HostAudioSnapshot): string | undefined {
	return hostAudio.defaults.input;
}

function actualOutputFor(hostAudio: HostAudioSnapshot): string | undefined {
	return hostAudio.defaults.output ?? hostAudio.defaults.systemOutput;
}

function image360Choice(status: AndroidStatus): MediaSourceChoice {
	if (status.emulator?.supportsImage360) {
		return {
			id: "image360:",
			label: "360 image file",
			apply: "device-restart",
			scope: "device",
		};
	}
	const version = status.emulator?.version;
	return {
		id: "image360:",
		label: version
			? `360 image requires Emulator 36.6.4+ (current ${version})`
			: "360 image requires Emulator 36.6.4+",
		apply: "unsupported",
		scope: "device",
	};
}

function validateAndroidCameraModeForStatus(
	face: "front" | "back",
	source: string,
	status: AndroidStatus,
): void {
	if (!validateAndroidCameraStartupMode(face, source)) {
		throw new Error(`Unsupported Android ${face} camera mode: ${source}`);
	}
	if (source.startsWith("image360:") && !status.emulator?.supportsImage360) {
		const version = status.emulator?.version;
		throw new Error(
			version
				? `Android image360 camera mode requires Emulator 36.6.4+; current emulator is ${version}`
				: "Android image360 camera mode requires Emulator 36.6.4+",
		);
	}
}

export function buildDeviceMediaState(
	deviceId: string,
	androidStatus?: AndroidStatus,
	webcams: AndroidWebcam[] = [],
	hostMicrophone?: boolean,
	hostAudio: HostAudioSnapshot = emptyHostAudioSnapshot(),
	iosWebcams: MediaSourceChoice[] = [],
	iosCameraStatus?: IosCameraStatus,
	storedRoute: StoredMediaRoute = {},
): DeviceMediaState {
	const inputDeviceId = actualInputFor(hostAudio);
	const outputDeviceId = actualOutputFor(hostAudio);
	const outputDevice = hostAudio.output.find(
		(device) => device.id === outputDeviceId,
	);
	const preferredInputDeviceId = storedRoute.inputDeviceId;
	const preferredOutputDeviceId = storedRoute.outputDeviceId;
	const inputChoices = hostInputChoices(hostAudio);
	const outputChoices = hostOutputChoices(hostAudio);
	if (!androidStatus) {
		const attached =
			iosCameraStatus?.alive === true &&
			(iosCameraStatus.bundleIds?.length ?? 0) > 0;
		const apply: MediaApplyMode = attached ? "live" : "app-relaunch";
		const injectedSources: MediaSourceChoice[] = [
			{ id: "placeholder", label: "Test pattern", apply, scope: "app" },
			{ id: "image", label: "Image file", apply, scope: "app" },
			{ id: "video", label: "Video file", apply, scope: "app" },
			...iosWebcams.map((choice) => ({
				...choice,
				apply,
				scope: "app" as const,
			})),
		];
		const cameraSource =
			iosCameraStatus?.source === "webcam"
				? iosCameraStatus.arg
				: (iosCameraStatus?.source ?? "placeholder");
		return {
			platform: "ios",
			deviceKind: "simulator",
			deviceId,
			camera: {
				owner: "agentsims-injection",
				source: cameraSource,
				sourceChoices: injectedSources,
				frontChoices: [],
				backChoices: [],
				supportsFiles: true,
				supportsLivePoster: false,
				attachedApps: iosCameraStatus?.bundleIds ?? [],
				status: attached ? "attached" : "not-attached",
			},
			audioInput: {
				current: "system-default",
				currentDeviceId: inputDeviceId,
				currentDeviceLabel: hostAudioLabel(
					hostAudio.input,
					inputDeviceId,
					"Mac default input",
				),
				preferredDeviceId: preferredInputDeviceId,
				preferredDeviceLabel: hostAudioLabel(
					hostAudio.input,
					preferredInputDeviceId,
					"No saved preference",
				),
				choices: inputChoices,
				scope: "host-global",
			},
			audioOutput: {
				current: "host-system-default",
				currentDeviceId: outputDeviceId,
				currentDeviceLabel: hostAudioLabel(
					hostAudio.output,
					outputDeviceId,
					"Mac default output",
				),
				preferredDeviceId: preferredOutputDeviceId,
				preferredDeviceLabel: hostAudioLabel(
					hostAudio.output,
					preferredOutputDeviceId,
					"No saved preference",
				),
				choices: outputChoices,
				scope: "host-global",
				volume: outputDevice?.volume,
				volumeSettable: outputDevice?.volumeSettable,
			},
		};
	}

	const emulator = /^emulator-\d+$/.test(androidStatus.serial);
	if (!emulator) {
		return {
			platform: "android",
			deviceKind: "physical",
			deviceId,
			camera: {
				owner: "device",
				status: "device-owned",
				frontChoices: [],
				backChoices: [],
				supportsFiles: false,
				supportsLivePoster: false,
			},
			audioInput: { current: "device", choices: [] },
			audioOutput: { current: "device", choices: [] },
		};
	}

	const sharedCameraChoices: MediaSourceChoice[] = [
		{
			id: "emulated",
			label: "Emulated camera",
			apply: "device-restart",
			scope: "device",
		},
		{
			id: "environment",
			label: "Virtual scene environment",
			apply: "device-restart",
			scope: "device",
		},
		...webcamChoices(webcams),
		{
			id: "imagefile:",
			label: "Image file",
			apply: "device-restart",
			scope: "device",
		},
		{
			id: "videofile:",
			label: "Video file",
			apply: "device-restart",
			scope: "device",
		},
		image360Choice(androidStatus),
		{ id: "none", label: "Disabled", apply: "device-restart", scope: "device" },
	];
	const androidMediaVolume = androidStatus.audio.mediaVolume;
	return {
		platform: "android",
		deviceKind: "emulator",
		deviceId,
		camera: {
			owner: "android-emulator",
			front: storedRoute.androidCameraFront ?? androidStatus.camera.front,
			back: storedRoute.androidCameraBack ?? androidStatus.camera.back,
			frontChoices: sharedCameraChoices,
			backChoices: sharedCameraChoices,
			supportsFiles: true,
			supportsLivePoster: false,
		},
		audioInput: {
			current:
				hostMicrophone === undefined
					? androidStatus.camera.audioInput === undefined
						? "unknown"
						: androidStatus.camera.audioInput
							? "host"
							: "disabled"
					: hostMicrophone
						? "host"
						: "disabled",
			currentDeviceId:
				(hostMicrophone ?? androidStatus.camera.audioInput)
					? inputDeviceId
					: undefined,
			currentDeviceLabel:
				(hostMicrophone ?? androidStatus.camera.audioInput)
					? hostAudioLabel(hostAudio.input, inputDeviceId, "Mac default input")
					: undefined,
			preferredDeviceId: preferredInputDeviceId,
			preferredDeviceLabel: hostAudioLabel(
				hostAudio.input,
				preferredInputDeviceId,
				"No saved preference",
			),
			choices: [
				...inputChoices,
				{ id: "disabled", label: "Disabled", apply: "live", scope: "device" },
			],
			scope: "host-global",
		},
		audioOutput: {
			current: "host-system-default",
			currentDeviceId: outputDeviceId,
			currentDeviceLabel: hostAudioLabel(
				hostAudio.output,
				outputDeviceId,
				"Mac default output",
			),
			preferredDeviceId: preferredOutputDeviceId,
			preferredDeviceLabel: hostAudioLabel(
				hostAudio.output,
				preferredOutputDeviceId,
				"No saved preference",
			),
			choices: outputChoices,
			scope: "host-global",
			volume: androidMediaVolume
				? (androidMediaVolume.current - androidMediaVolume.min) /
					Math.max(1, androidMediaVolume.max - androidMediaVolume.min)
				: outputDevice?.volume,
			volumeSettable: androidMediaVolume ? true : outputDevice?.volumeSettable,
			volumeLevel: androidMediaVolume,
		},
	};
}

export function isMediaRouteAction(value: unknown): value is MediaRouteAction {
	if (!value || typeof value !== "object" || !("action" in value)) return false;
	const action = value.action;
	return (
		action === "android-host-microphone" ||
		action === "android-camera-source" ||
		action === "android-camera-sources" ||
		action === "ios-camera-source" ||
		action === "host-audio-input" ||
		action === "host-audio-output" ||
		action === "android-output-volume" ||
		action === "audio-output-volume" ||
		action === "host-audio-output-volume" ||
		action === "android-virtual-scene-image" ||
		action === "restart-device"
	);
}

async function waitForAndroidDisconnect(serial: string): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const devices = await listAndroidDevices().catch(() => []);
		if (
			!devices.some(
				(device) => device.serial === serial && device.state === "device",
			)
		)
			return;
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
}

export class MediaRouter {
	constructor(private readonly base: string) {}

	async read(device: string): Promise<DeviceMediaState> {
		const serial = androidSerialFromStateId(device);
		const hostAudio = await listHostAudioDevices().catch(() =>
			emptyHostAudioSnapshot(),
		);
		if (!serial) {
			const storedRoute = getStoredMediaRoute(device);
			const [iosWebcams, iosCameraStatus] = await Promise.all([
				listIosWebcams()
					.then((webcams) =>
						webcams.map((webcam) => ({
							id: webcam.id,
							label: webcam.label,
							apply: "app-relaunch" as const,
							scope: "app" as const,
						})),
					)
					.catch(() => []),
				getIosCameraStatus(device).catch(() => ({
					alive: false,
					bundleIds: [],
				})),
			]);
			return buildDeviceMediaState(
				device,
				undefined,
				[],
				undefined,
				hostAudio,
				iosWebcams,
				iosCameraStatus,
				storedRoute,
			);
		}

		const status = await getAndroidStatus(serial);
		const storedRoute = status.avdName
			? getStoredMediaRoute(androidAvdStateId(status.avdName))
			: getStoredMediaRoute(device);
		const webcams = /^emulator-\d+$/.test(serial)
			? await listAndroidWebcams().catch(() => [])
			: [];
		return buildDeviceMediaState(
			device,
			status,
			webcams,
			microphoneRoutes.get(serial),
			hostAudio,
			[],
			undefined,
			storedRoute,
		);
	}

	async apply(
		device: string,
		body: MediaRouteAction,
		publicPort: number,
	): Promise<MediaRouteResult> {
		const serial = androidSerialFromStateId(device);
		switch (body.action) {
			case "android-host-microphone":
				if (!serial)
					throw new Error(
						"Android host microphone is only available for Android emulators",
					);
				if (typeof body.enabled !== "boolean")
					throw new Error("Missing enabled flag");
				await setAndroidHostMicrophone(serial, body.enabled);
				microphoneRoutes.set(serial, body.enabled);
				return { ok: true, apply: "live" };

			case "android-camera-source": {
				if (!serial)
					throw new Error(
						"Android camera source is only available for Android emulators",
					);
				const status = await getAndroidStatus(serial);
				if (!status.avdName)
					throw new Error("The running emulator has no AVD name");
				if (
					(body.face !== "front" && body.face !== "back") ||
					typeof body.source !== "string"
				) {
					throw new Error("Invalid camera source request");
				}
				validateAndroidCameraModeForStatus(body.face, body.source, status);
				const routeKey = androidAvdStateId(status.avdName);
				const current = getStoredMediaRoute(routeKey);
				updateStoredMediaRoute(
					routeKey,
					body.face === "front"
						? {
								androidCameraFront: body.source,
								androidCameraBack:
									current.androidCameraBack ?? status.camera.back,
							}
						: {
								androidCameraFront:
									current.androidCameraFront ?? status.camera.front,
								androidCameraBack: body.source,
							},
				);
				return { ok: true, apply: "device-restart" };
			}

			case "android-camera-sources": {
				if (!serial)
					throw new Error(
						"Android camera sources are only available for Android emulators",
					);
				const status = await getAndroidStatus(serial);
				if (!status.avdName)
					throw new Error("The running emulator has no AVD name");
				if (typeof body.front !== "string" || typeof body.back !== "string") {
					throw new Error("Invalid Android camera sources request");
				}
				validateAndroidCameraModeForStatus("front", body.front, status);
				validateAndroidCameraModeForStatus("back", body.back, status);
				updateStoredMediaRoute(androidAvdStateId(status.avdName), {
					androidCameraFront: body.front,
					androidCameraBack: body.back,
				});
				return { ok: true, apply: "device-restart" };
			}

			case "ios-camera-source": {
				if (serial)
					throw new Error(
						"iOS camera injection is only available for iOS simulators",
					);
				if (
					body.source !== "placeholder" &&
					body.source !== "webcam" &&
					body.source !== "image" &&
					body.source !== "video"
				) {
					throw new Error("Invalid iOS camera source");
				}
				const apply = await attachOrSwitchIosCameraSource(
					device,
					body.source,
					body.source === "webcam" ? body.deviceId : body.path,
				);
				return { ok: true, apply };
			}

			case "host-audio-input":
				if (typeof body.deviceId !== "string" || body.deviceId.length === 0) {
					throw new Error("Missing host input device");
				}
				await setHostDefaultInput(body.deviceId);
				updateStoredMediaRoute(device, { inputDeviceId: body.deviceId });
				if (serial && /^emulator-\d+$/.test(serial)) {
					await setAndroidHostMicrophone(serial, true);
					microphoneRoutes.set(serial, true);
				}
				return { ok: true, apply: "live" };

			case "host-audio-output":
				if (typeof body.deviceId !== "string" || body.deviceId.length === 0) {
					throw new Error("Missing host output device");
				}
				await setHostDefaultOutput(body.deviceId);
				updateStoredMediaRoute(device, { outputDeviceId: body.deviceId });
				return { ok: true, apply: "live" };

			case "android-output-volume":
				if (!serial || !/^emulator-\d+$/.test(serial)) {
					throw new Error(
						"Android media volume is only available for Android emulators",
					);
				}
				if (!Number.isInteger(body.level))
					throw new Error("Android media volume level must be an integer");
				await setAndroidMediaVolumeLevel(serial, body.level);
				return { ok: true, apply: "live" };

			case "host-audio-output-volume":
				if (
					typeof body.volume !== "number" ||
					!Number.isFinite(body.volume) ||
					body.volume < 0 ||
					body.volume > 1
				) {
					throw new Error("Output volume must be between 0 and 1");
				}
				if (typeof body.deviceId !== "string" || body.deviceId.length === 0) {
					throw new Error("Missing host output device");
				}
				await setHostOutputVolume(body.deviceId, body.volume);
				return { ok: true, apply: "live" };

			case "audio-output-volume":
				if (
					typeof body.volume !== "number" ||
					!Number.isFinite(body.volume) ||
					body.volume < 0 ||
					body.volume > 1
				) {
					throw new Error("Output volume must be between 0 and 1");
				}
				if (serial && /^emulator-\d+$/.test(serial))
					await setAndroidMediaVolume(serial, body.volume);
				else if (typeof body.deviceId === "string" && body.deviceId.length > 0)
					await setHostOutputVolume(body.deviceId, body.volume);
				else throw new Error("Missing host output device");
				return { ok: true, apply: "live" };

			case "android-virtual-scene-image":
				if (!serial)
					throw new Error(
						"Android virtual scene images are only available for Android emulators",
					);
				if (body.surface !== "wall" && body.surface !== "table")
					throw new Error("Invalid virtual scene surface");
				if (body.path !== undefined && typeof body.path !== "string")
					throw new Error("Invalid image path");
				await setAndroidVirtualSceneImage(serial, body.surface, body.path);
				return { ok: true, apply: "live" };

			case "restart-device": {
				if (!serial)
					throw new Error(
						"Restart from media routing is only available for Android emulators",
					);
				const status = await getAndroidStatus(serial);
				if (!status.avdName)
					throw new Error("Only Android emulators can be restarted here");
				const shutdownError = await deviceLifecycle.shutdown(device);
				if (shutdownError) throw new Error(shutdownError);
				await waitForAndroidDisconnect(serial);
				const started = await deviceLifecycle.start(
					androidAvdStateId(status.avdName),
					publicPort,
					this.base,
				);
				if (started.error) throw new Error(started.error);
				return { ok: true, apply: "device-restart", device: started.device };
			}
		}
	}
}
