import { simEndpoint } from "../preview/sim-endpoint";

export interface AppDetails {
	bundleId: string;
	isReactNative: boolean;
	pid?: number;
	displayName?: string;
	shortVersion?: string;
	bundleVersion?: string;
	minOS?: string;
	executable?: string;
	appPath?: string;
	iconDataUrl?: string | null;
	loading: boolean;
	error?: string;
}

export async function fetchAppDetails(
	udid: string,
	bundleId: string,
): Promise<Partial<AppDetails>> {
	try {
		const response = await fetch(
			simEndpoint(`device/${encodeURIComponent(udid)}/app`),
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ operation: "details", value: bundleId }),
			},
		);
		if (!response.ok)
			return {
				error: (await response.text()) || "App metadata is unavailable",
			};
		return (await response.json()) as Partial<AppDetails>;
	} catch (error) {
		return {
			error:
				error instanceof Error ? error.message : "App metadata is unavailable",
		};
	}
}

// Process-wide icon cache — keyed by udid:bundleId so a switch between
// devices doesn't reuse stale art. Values are pending fetches OR resolved
// data URLs (or null when no icon could be located).
export const appIconCache = new Map<
	string,
	Promise<string | null> | string | null
>();

export function fetchAppIcon(
	udid: string,
	bundleId: string,
): Promise<string | null> {
	const key = `${udid}:${bundleId}`;
	const existing = appIconCache.get(key);
	if (existing !== undefined) {
		return Promise.resolve(existing as string | null | Promise<string | null>);
	}
	const pending = fetchAppDetails(udid, bundleId)
		.then((d) => {
			const url = d.iconDataUrl ?? null;
			appIconCache.set(key, url);
			return url;
		})
		.catch(() => {
			appIconCache.set(key, null);
			return null;
		});
	appIconCache.set(key, pending);
	return pending;
}
