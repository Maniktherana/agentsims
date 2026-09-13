import type { DeviceState } from "../../../core/tools/devices/state";
import type { ServerConfigValue } from "../../runtime/config";
import { exposeDeviceState } from "../device-urls";
import { selectDeviceState } from "../../../core/tools/devices/lifecycle";
import { previewConfigForState } from "../connection-config";

export function json(body: unknown, status = 200): Response {
	return Response.json(body, {
		status,
		headers: { "Cache-Control": "no-store" },
	});
}

export function bytes(
	bytes: Uint8Array,
	contentType: string,
	cacheControl = "no-store",
): Response {
	const body = new Uint8Array(bytes.byteLength);
	body.set(bytes);
	return new Response(body, {
		headers: { "Content-Type": contentType, "Cache-Control": cacheControl },
	});
}

export function requestSource(source: unknown): Request {
	if (!(source instanceof Request))
		throw new Error("HTTP request source is not a Web Request");
	return source;
}

export function requestedDevice(
	url: URL,
	config: ServerConfigValue,
): string | null {
	return url.searchParams.get("device") ?? config.device ?? null;
}

export function selectedState(
	url: URL,
	config: ServerConfigValue,
	states: readonly DeviceState[],
): DeviceState | null {
	return selectDeviceState([...states], requestedDevice(url, config));
}

export function exposedState(
	request: Request,
	config: ServerConfigValue,
	state: DeviceState,
): DeviceState {
	return exposeDeviceState(
		state,
		request.headers.get("host") ?? undefined,
		config.basePath,
		request.headers.get("x-forwarded-proto") === "https" ? "https" : "http",
		config.proxyHelpers,
	);
}

export function previewConfig(
	request: Request,
	config: ServerConfigValue,
	state: DeviceState,
): unknown {
	return previewConfigForState(
		exposedState(request, config, state),
		config.basePath,
		config.agentsimsBin,
		config.execToken,
		config.codec,
		config.proxyHelpers,
	);
}
