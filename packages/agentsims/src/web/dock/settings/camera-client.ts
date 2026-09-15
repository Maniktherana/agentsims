import type {
	CameraWebcamChoices,
	DeviceMediaState,
	MediaRouteAction,
} from "../../../core/tools/media";
import { simEndpoint } from "../../preview/sim-endpoint";

export function createCameraClient(
	device: string,
	fetcher: typeof fetch = fetch,
) {
	async function request<T>(
		path: string,
		action?: MediaRouteAction | Record<string, never>,
	): Promise<T> {
		const response = await fetcher(
			`${simEndpoint(path)}?device=${encodeURIComponent(device)}`,
			{
				cache: "no-store",
				...(action
					? {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify(action),
						}
					: {}),
			},
		);
		const body = await response.json();
		if (!response.ok)
			throw new Error(
				body.error ?? `Camera request failed (${response.status})`,
			);
		return body as T;
	}

	return {
		async status() {
			const { camera } = await request<DeviceMediaState>("media");
			const source =
				camera.source &&
				!["placeholder", "image", "video", "webcam"].includes(camera.source)
					? "webcam"
					: camera.source;
			return {
				alive: camera.alive ?? camera.status === "attached",
				source,
				arg: camera.arg ?? (source === "webcam" ? camera.source : undefined),
				mirror: camera.mirror,
				helperPid: camera.helperPid,
				bundleIds: camera.attachedApps ?? [],
			};
		},
		async webcams() {
			const result = await request<CameraWebcamChoices>("media/camera/webcams");
			return result.webcams.map(({ id, label }) => ({ id, name: label }));
		},
		source(
			source: "placeholder" | "webcam" | "image" | "video",
			arg?: string,
			bundleId?: string,
		) {
			return request("media", {
				action: "ios-camera-source",
				source,
				...(source === "webcam" ? { deviceId: arg } : { path: arg }),
				...(bundleId ? { bundleId } : {}),
			});
		},
		mirror(mirror: "on" | "off") {
			return request("media", { action: "ios-camera-mirror", mirror });
		},
		stop() {
			return request("media/camera/stop", {});
		},
	};
}
