import { useCallback, useEffect, useState } from "react";
import {
	proxyDevToolsTargetForBrowser,
	type DevToolsResponse,
	type DevToolsTarget,
} from "../../devtools/client";

export function useDevTools(endpoint: string | undefined, enabled: boolean) {
	const [targets, setTargets] = useState<DevToolsTarget[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const refresh = useCallback(async () => {
		if (!endpoint) return;
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(endpoint, { cache: "no-store" });
			const json = (await res.json()) as DevToolsResponse;
			if (!res.ok || json.error)
				throw new Error(json.error || "Failed to list DevTools targets");
			const location = typeof window === "undefined" ? null : window.location;
			const rawTargets = json.targets ?? [];
			setTargets(
				location
					? rawTargets.map((target) =>
							proxyDevToolsTargetForBrowser(target, location),
						)
					: rawTargets,
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start DevTools");
		} finally {
			setLoading(false);
		}
	}, [endpoint]);

	useEffect(() => {
		if (!enabled) return;
		void refresh();
		const timer = setInterval(() => void refresh(), 2500);
		return () => clearInterval(timer);
	}, [enabled, refresh]);

	return { targets, error, loading, refresh };
}
