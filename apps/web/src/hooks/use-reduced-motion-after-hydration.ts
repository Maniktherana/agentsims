import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
	const query = window.matchMedia(QUERY);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

/**
 * The reduced motion preference. The server cannot read it, so the server
 * and the hydration render show a picture with motion. The preference
 * applies in the render after hydration, and directly on a client render.
 */
export function useReducedMotionAfterHydration() {
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(QUERY).matches,
		() => false,
	);
}
