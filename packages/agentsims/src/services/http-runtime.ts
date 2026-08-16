import { Context, Effect, Layer } from "effect";
import {
	androidSerialFromStateId,
	getAndroidForegroundApp,
} from "../android/device/device";
import { getDeviceSession } from "../ios/session/session";
import {
	decodeForegroundApp,
	type ForegroundApp,
} from "../shared/foreground-app";
import {
	createAxStreamerCache,
	type AxStreamerCache,
} from "../accessibility/snapshot";
import {
	deviceCommands,
	type DeviceCommands,
} from "../commands/device-commands";
import {
	MediaCommands,
	type MediaOperations,
} from "../commands/media-commands";
import type { DeviceState } from "../shared/state";
import { readDeviceStates } from "../server/devices/device-lifecycle";
import {
	ensureInspectWebKitBridge,
	type WebKitBridge,
} from "../server/http/devtools-bridge";
import type { ScreenshotPersistence } from "../server/http/screenshot-service";
import { saveScreenshotPng } from "../server/http/screenshot-service";
import { MediaRouter } from "../server/media/router";
import type { PreviewAssetMap } from "../server/preview/preview-assets";
export type HttpServerOptions = {
	basePath: string;
	host: string;
	port: number;
	device?: string;
	codec?: string;
	proxyHelpers: boolean;
	previewRoot: string;
	execToken: string;
	agentsimsBin: string;
	axStreamers?: AxStreamerCache;
	previewAssets?: PreviewAssetMap;
	readDeviceStates?: () => Promise<DeviceState[]>;
	readForegroundApp?: (device: string) => Promise<ForegroundApp | null>;
	deviceCommands?: Pick<
		DeviceCommands,
		"list" | "memory" | "workspaces" | "observe" | "act" | "start" | "shutdown"
	>;
	mediaOperations?: MediaOperations;
	getBridge?: () => Promise<WebKitBridge>;
	saveScreenshot?: ScreenshotPersistence;
};

export type HttpRuntimeService = Omit<
	HttpServerOptions,
	| "basePath"
	| "axStreamers"
	| "readDeviceStates"
	| "readForegroundApp"
	| "deviceCommands"
	| "mediaOperations"
	| "getBridge"
	| "saveScreenshot"
> & {
	basePath: "" | `/${string}`;
	streamers: AxStreamerCache;
	readonly readStates: Effect.Effect<DeviceState[]>;
	foregroundApp(device: string): Effect.Effect<ForegroundApp | null>;
	commands: Pick<
		DeviceCommands,
		"list" | "memory" | "workspaces" | "observe" | "act" | "start" | "shutdown"
	>;
	media: MediaCommands;
	readonly getBridge: Effect.Effect<WebKitBridge>;
	saveScreenshot: ScreenshotPersistence;
};

export class HttpRuntime extends Context.Tag("@agentsims/HttpRuntime")<
	HttpRuntime,
	HttpRuntimeService
>() {}

function normalizeBase(basePath: string): "" | `/${string}` {
	if (basePath === "/" || basePath === "") return "";
	return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

async function readForegroundApp(
	device: string,
): Promise<ForegroundApp | null> {
	const serial = androidSerialFromStateId(device);
	if (serial) return getAndroidForegroundApp(serial);
	return decodeForegroundApp(await getDeviceSession(device).readForeground());
}
export function httpRuntimeLayer(
	options: HttpServerOptions,
): Layer.Layer<HttpRuntime> {
	const basePath = normalizeBase(options.basePath);
	const readStates = options.readDeviceStates ?? readDeviceStates;
	const getBridge = options.getBridge ?? ensureInspectWebKitBridge;
	return Layer.succeed(HttpRuntime, {
		...options,
		basePath,
		streamers: options.axStreamers ?? createAxStreamerCache(),
		readStates: Effect.promise(readStates),
		foregroundApp: (device) =>
			Effect.promise(() =>
				(options.readForegroundApp ?? readForegroundApp)(device),
			),
		commands: options.deviceCommands ?? deviceCommands,
		media: new MediaCommands(
			options.mediaOperations ?? new MediaRouter(basePath),
		),
		getBridge: Effect.promise(getBridge),
		saveScreenshot: options.saveScreenshot ?? saveScreenshotPng,
	});
}
