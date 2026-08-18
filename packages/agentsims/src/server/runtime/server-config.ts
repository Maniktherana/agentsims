import { Context, Layer } from "effect";
import type { PreviewAssetMap } from "../preview/preview-assets";

export type ServerConfigValue = {
	basePath: "" | `/${string}`;
	host: string;
	port: number;
	device?: string;
	codec?: string;
	proxyHelpers: boolean;
	previewRoot: string;
	execToken: string;
	agentsimsBin: string;
	previewAssets?: PreviewAssetMap;
};

export type ServerConfigInput = Omit<ServerConfigValue, "basePath"> & {
	basePath: string;
};

export class ServerConfig extends Context.Tag("@agentsims/ServerConfig")<
	ServerConfig,
	ServerConfigValue
>() {}

function normalizeBasePath(basePath: string): "" | `/${string}` {
	if (basePath === "/" || basePath === "") return "";
	return `/${basePath.replace(/^\/+|\/+$/g, "")}`;
}

export function serverConfigLayer(input: ServerConfigInput) {
	return Layer.succeed(ServerConfig, {
		...input,
		basePath: normalizeBasePath(input.basePath),
	});
}
