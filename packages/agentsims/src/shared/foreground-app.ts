export type ForegroundApp = {
	bundleId: string;
	isReactNative: boolean;
	pid?: number;
};

export function decodeForegroundApp(value: unknown): ForegroundApp | null {
	if (!value || typeof value !== "object") return null;
	const app = value as Record<string, unknown>;
	if (typeof app.bundleId !== "string" || !app.bundleId) return null;
	if (app.isReactNative !== undefined && typeof app.isReactNative !== "boolean")
		return null;
	if (app.pid !== undefined && typeof app.pid !== "number") return null;
	return {
		bundleId: app.bundleId,
		isReactNative: app.isReactNative === true,
		...(typeof app.pid === "number" ? { pid: app.pid } : {}),
	};
}

export function decodeForegroundAppEvent(data: string): ForegroundApp | null {
	try {
		return decodeForegroundApp(JSON.parse(data));
	} catch {
		return null;
	}
}
