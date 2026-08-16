import type { DeviceState } from "../../shared/state";

function endpoint(basePath: string, path: string, device: string): string {
	return `${basePath}${path}?device=${encodeURIComponent(device)}`;
}

export function previewConfigForState(
	state: DeviceState,
	basePath: string,
	agentsimsBin: string,
	execToken: string,
	codec?: string,
	proxyHelpers = false,
): DeviceState & {
	basePath: string;
	appStateEndpoint: string;
	axEndpoint: string;
	devtoolsEndpoint: string;
	agentsimsBin: string;
	gridApiEndpoint: string;
	gridStartEndpoint: string;
	gridShutdownEndpoint: string;
	gridMemoryEndpoint: string;
	previewEndpoint: string;
	execToken: string;
	codec?: string;
	proxyHelpers?: boolean;
} {
	const gridApiBase = `${basePath === "" ? "" : basePath}/grid/api`;
	return {
		...state,
		basePath,
		appStateEndpoint: endpoint(basePath, "/appstate", state.device),
		axEndpoint: endpoint(basePath, "/ax", state.device),
		devtoolsEndpoint: endpoint(basePath, "/devtools", state.device),
		agentsimsBin,
		gridApiEndpoint: gridApiBase,
		gridStartEndpoint: `${gridApiBase}/start`,
		gridShutdownEndpoint: `${gridApiBase}/shutdown`,
		gridMemoryEndpoint: `${gridApiBase}/memory`,
		previewEndpoint: basePath === "" ? "/" : basePath,
		execToken,
		...(codec ? { codec } : {}),
		...(proxyHelpers ? { proxyHelpers: true } : {}),
	};
}
