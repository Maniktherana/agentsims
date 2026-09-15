import type { GridDevice } from "./grid";

type PreviewConfig = NonNullable<Window["__SIM_PREVIEW__"]>;

/** Bind a device route explicitly, preserving custom mounts and other params. */
export function previewDeviceEndpoint(
	endpoint: string,
	deviceId: string,
): string {
	const url = new URL(endpoint, "http://agentsims.invalid");
	url.searchParams.set("device", deviceId);
	return /^https?:\/\//.test(endpoint)
		? url.href
		: `${url.pathname}${url.search}${url.hash}`;
}

/** A catalog helper inherits host settings, never another device's identity. */
export function previewConfigFromGridDevice(
	device: GridDevice,
	injected: Window["__SIM_PREVIEW__"],
	basePath: string,
): PreviewConfig | null {
	if (!device.helper) return null;
	const mount = basePath.replace(/\/+$/, "");
	return {
		device: device.device,
		pid: injected?.device === device.device ? injected.pid : 0,
		...device.helper,
		basePath,
		appStateEndpoint: previewDeviceEndpoint(
			injected?.appStateEndpoint ?? `${mount}/appstate`,
			device.device,
		),
		axEndpoint: previewDeviceEndpoint(
			injected?.axEndpoint ?? `${mount}/ax`,
			device.device,
		),
		devtoolsEndpoint: previewDeviceEndpoint(
			injected?.devtoolsEndpoint ?? `${mount}/devtools`,
			device.device,
		),
		gridApiEndpoint: injected?.gridApiEndpoint,
		gridStartEndpoint: injected?.gridStartEndpoint,
		gridShutdownEndpoint: injected?.gridShutdownEndpoint,
		gridMemoryEndpoint: injected?.gridMemoryEndpoint,
		previewEndpoint: injected?.previewEndpoint,
		agentsimsBin: injected?.agentsimsBin,
		execToken: injected?.execToken,
		codec: injected?.codec,
		proxyHelpers: injected?.proxyHelpers,
	};
}

type LocationLike = Pick<Location, "host" | "protocol">;

export function proxyPreviewConfigForBrowser(
	config: PreviewConfig | null | undefined,
	location: LocationLike,
): PreviewConfig | null {
	if (!config) return null;
	if (!config.device) return config;
	// Only re-anchor when the server opted into same-origin proxying. Without it
	// the config already holds the helper's direct URLs (embedded mounts), and
	// rewriting them to `/helper/...` would point at routes the host server
	// doesn't proxy.
	if (!config.proxyHelpers) return config;

	const basePath =
		config.basePath === "/" ? "" : (config.basePath ?? "").replace(/\/+$/, "");
	const devicePath = `${basePath}/helper/${encodeURIComponent(config.device)}`;
	const streamPath = config.device.startsWith("android:")
		? "stream.avcc"
		: "stream.mjpeg";
	const httpOrigin = `${location.protocol}//${location.host}`;
	const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";

	return {
		...config,
		url: `${httpOrigin}${devicePath}`,
		streamUrl: `${httpOrigin}${devicePath}/${streamPath}`,
		wsUrl: `${wsProtocol}//${location.host}${devicePath}/ws`,
	};
}
