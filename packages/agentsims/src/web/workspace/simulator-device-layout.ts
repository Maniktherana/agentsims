import {
	displayStreamConfig,
	fallbackScreenSize,
	getDeviceType,
	isLandscapeConfig,
	simulatorAspectRatio,
	simulatorMaxWidth,
	type DeviceType,
	type StreamConfig,
} from "../simulator/index";
import type { DeviceKitChromeDescriptor } from "./grid";

export const EMBEDDED_WORKSPACE_VERTICAL_RESERVE = 200;

export interface SimulatorDeviceLayout {
	deviceType: DeviceType;
	streamConfig: StreamConfig;
	useChrome: boolean;
	defaultWidth: number;
	aspectRatio: string;
	aspectRatioValue: number;
}

/**
 * One frame model for placeholders and live simulators. Loading may lack a
 * stream config, but must never switch to asset-intrinsic sizing.
 */
export function resolveSimulatorDeviceLayout({
	deviceName,
	chrome,
	streamConfig,
}: {
	deviceName?: string | null;
	chrome?: DeviceKitChromeDescriptor | null;
	streamConfig?: StreamConfig | null;
}): SimulatorDeviceLayout {
	const deviceType = getDeviceType(deviceName);
	const activeStreamConfig =
		streamConfig && streamConfig.width > 0 && streamConfig.height > 0
			? streamConfig
			: {
					...fallbackScreenSize(deviceType, deviceName),
					orientation: "portrait" as const,
				};
	const frameMaxWidth = simulatorMaxWidth(deviceType, activeStreamConfig);
	const displayConfig = displayStreamConfig(activeStreamConfig)!;
	const screenAspectRatioValue = displayConfig.width / displayConfig.height;
	const useChrome = Boolean(chrome) && !isLandscapeConfig(activeStreamConfig);
	const chromeScale = useChrome
		? chrome!.frame.width / chrome!.screen.width
		: 1;

	return {
		deviceType,
		streamConfig: activeStreamConfig,
		useChrome,
		defaultWidth: frameMaxWidth * chromeScale,
		aspectRatio: useChrome
			? `${chrome!.frame.width} / ${chrome!.frame.height}`
			: simulatorAspectRatio(activeStreamConfig),
		aspectRatioValue: useChrome
			? chrome!.frame.width / chrome!.frame.height
			: screenAspectRatioValue,
	};
}
