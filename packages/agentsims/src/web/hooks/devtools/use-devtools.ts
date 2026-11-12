import { useCallback, useEffect, useRef, useState } from "react";
import {
	proxyDevToolsTargetForBrowser,
	type DevToolsResponse,
	type DevToolsTarget,
} from "../../devtools/client";

/** A poll that returns the same targets keeps the previous array, so nothing renders. */
export function reuseDevToolsTargets(
	previous: DevToolsTarget[],
	next: DevToolsTarget[],
): DevToolsTarget[] {
	return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
}

export function useDevTools(endpoint: string | undefined, enabled: boolean) {
	const [targets, setTargets] = useState<DevToolsTarget[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	const loadedRef = useRef(false);
	const refresh = useCallback(async () => {
		if (!endpoint) return;
		// Only the first load shows progress. A background poll changes no state
		// unless its result changes.
		if (!loadedRef.current) setLoading(true);
		try {
			const res = await fetch(endpoint, { cache: "no-store" });
			const json = (await res.json()) as DevToolsResponse;
			if (!res.ok || json.error)
				throw new Error(json.error || "Failed to list DevTools targets");
			const location = typeof window === "undefined" ? null : window.location;
			const rawTargets = json.targets ?? [];
			const next = location
				? rawTargets.map((target) =>
						proxyDevToolsTargetForBrowser(target, location),
					)
				: rawTargets;
			setTargets((previous) => reuseDevToolsTargets(previous, next));
			setError(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to start DevTools");
		} finally {
			loadedRef.current = true;
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
