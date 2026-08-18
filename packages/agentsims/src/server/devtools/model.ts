import type { Effect } from "effect";

export type DevToolsProviderId = "webkit" | "android-cdp";

export type DevToolsProviderTarget = {
	id: string;
	device: string;
	provider: DevToolsProviderId;
	title: string;
	url: string;
	type: string;
	appName?: string;
	bundleId?: string;
	inUseByOtherInspector?: boolean;
	webSocketUrl: string;
};

export type DevToolsTarget = Omit<DevToolsProviderTarget, "webSocketUrl">;

export type DevToolsProvider = {
	list(device: string): Effect.Effect<DevToolsProviderTarget[], unknown>;
	highlight?(targetId: string, on: boolean): Effect.Effect<void, unknown>;
	releaseHighlights?(): Effect.Effect<void>;
};
