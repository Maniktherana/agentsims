import { useSyncExternalStore } from "react";
import { ALL_SCREENS, FIRST_SCREENS } from "./data";

/*
 * The device screens of the tour. None loads with the page. When the
 * picture comes near the viewport, the screens of the first frame load
 * first, then the others. An image gets its source only once its screen is
 * decoded, so no frame shows a half-loaded screen.
 */

const decoding = new Map<string, Promise<void>>();
const decoded = new Set<string>();
/* The decoded images stay referenced, so a screen drawn again comes from memory, with no request. */
const images = new Map<string, HTMLImageElement>();
const listeners = new Set<() => void>();

function decode(src: string): Promise<void> {
	let pending = decoding.get(src);
	if (!pending) {
		const image = new Image();
		image.src = src;
		images.set(src, image);
		pending = image.decode().then(() => {
			decoded.add(src);
			for (const listener of listeners) listener();
		});
		decoding.set(src, pending);
	}
	return pending;
}

/** Starts to load every screen of the story, those of the first frame first. */
export function loadScreens() {
	void Promise.allSettled(FIRST_SCREENS.map(decode)).then(() => {
		for (const src of ALL_SCREENS) void decode(src);
	});
}

/** Null when the images are decoded; otherwise a promise that settles when they are. */
export function screensReady(srcs: readonly string[]): Promise<void> | null {
	const missing = srcs.filter((src) => !decoded.has(src));
	return missing.length ? Promise.all(missing.map(decode)).then(() => undefined) : null;
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The source of a screen image once it is decoded. The server and hydration render none. */
export function useScreenSrc(src: string): string | undefined {
	const ready = useSyncExternalStore(
		subscribe,
		() => decoded.has(src),
		() => false,
	);
	return ready ? src : undefined;
}
