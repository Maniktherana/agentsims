import { androidSerialFromStateId } from "../../android/device/device";
import type { DeviceState } from "../../shared/state";

export function exposeDeviceState(
	state: DeviceState,
	hostHeader: string | undefined,
	base = "",
	protocol: "http" | "https" = "http",
	proxy = false,
): DeviceState {
	if (!hostHeader) return state;
	if (!proxy) {
		let hostname: string;
		try {
			hostname = new URL(`http://${hostHeader}`).hostname;
		} catch {
			return state;
		}
		if (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "[::1]"
		)
			return state;
		const rewrite = (value: string) => value.replace("127.0.0.1", hostname);
		return {
			...state,
			url: rewrite(state.url),
			streamUrl: rewrite(state.streamUrl),
			wsUrl: rewrite(state.wsUrl),
		};
	}
	const normalizedBase = base === "/" ? "" : base.replace(/\/+$/, "");
	const devicePath = `${normalizedBase}/helper/${encodeURIComponent(state.device)}`;
	const streamPath = androidSerialFromStateId(state.device)
		? "stream.avcc"
		: "stream.mjpeg";
	const origin = `${protocol}://${hostHeader}`;
	const wsOrigin = `${protocol === "https" ? "wss" : "ws"}://${hostHeader}`;
	return {
		...state,
		url: `${origin}${devicePath}`,
		streamUrl: `${origin}${devicePath}/${streamPath}`,
		wsUrl: `${wsOrigin}${devicePath}/ws`,
	};
}
