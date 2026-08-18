import { Cause, Effect, Exit, Option } from "effect";
import type { ApplicationCommandError } from "../../../commands/errors";
import {
	commandFailure,
	isApplicationCommandError,
} from "../../../commands/errors";
import type { DeviceState } from "../../../shared/state";
import type { ServerConfigValue } from "../../runtime/server-config";
import { exposeDeviceState } from "../../devices/device-state-exposure";
import { selectDeviceState } from "../../devices/device-lifecycle";
import { previewConfigForState } from "../../preview/preview-config";
import { commandErrorStatus } from "../command";

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

export async function commandResponse<A>(
	effect: Effect.Effect<A, ApplicationCommandError>,
	success: (value: A) => Response = (value) => json(value),
): Promise<Response> {
	const exit = await Effect.runPromiseExit(effect);
	if (Exit.isSuccess(exit)) return success(exit.value);
	const failure = Cause.failureOption(exit.cause);
	const error = Option.isSome(failure)
		? failure.value
		: Cause.squash(exit.cause);
	const commandError = isApplicationCommandError(error)
		? error
		: commandFailure(error);
	return json(
		{ error: commandError.message, type: commandError._tag },
		commandErrorStatus(commandError),
	);
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
