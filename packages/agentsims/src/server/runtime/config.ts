import { Context, Layer } from "effect";

export const RUNTIME_CAPABILITIES = Object.freeze({
	managedServer: 1,
	sourceContext: 1,
	appLogs: 1,
	context: 1,
	workspace: 1,
});

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
