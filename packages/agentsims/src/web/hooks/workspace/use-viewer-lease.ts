import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
	claimDevices,
	getViewerState,
	releaseDevices,
	subscribeViewerState,
} from "../../simulator/input/exec";

const RECONNECT_MS = 2_000;

function tabInUse(): boolean {
	return document.visibilityState === "visible" && document.hasFocus();
}

/**
 * The holder of a device is the tab that the user works in. Only the holder
 * streams video, reads the accessibility tree, and sends input.
 *
 * `active` is false until this tab has a viewer ID, so every live request
 * carries it. A tab claims its device when the device has no holder, when the
 * tab gets focus, and when `claim` is called (for example, on a click). A tab
 * never takes a device back only because another tab claimed it.
 */
export function useViewerLease(device: string): {
	active: boolean;
	viewer: string | null;
	claim: () => void;
} {
	const state = useSyncExternalStore(
		subscribeViewerState,
		getViewerState,
		getViewerState,
	);
	const holder = state.holders[device];
	const viewer = state.viewer;
	const active = viewer !== null && (holder === undefined || holder === viewer);

	const claim = useCallback(() => {
		void claimDevices([device]).catch(() => {});
	}, [device]);

	// Connect, and claim a device that no tab holds.
	useEffect(() => {
		if (viewer === null) {
			claim();
			const retry = setInterval(claim, RECONNECT_MS);
			return () => clearInterval(retry);
		}
		if (holder === undefined) claim();
	}, [claim, holder, viewer]);

	// The tab that the user moves to takes the device.
	useEffect(() => {
		const onUse = () => {
			if (tabInUse()) claim();
		};
		window.addEventListener("focus", onUse);
		document.addEventListener("visibilitychange", onUse);
		return () => {
			window.removeEventListener("focus", onUse);
			document.removeEventListener("visibilitychange", onUse);
		};
	}, [claim]);

	// A tab that stops showing a device gives it back.
	useEffect(
		() => () => {
			void releaseDevices([device]).catch(() => {});
		},
		[device],
	);

	return { active, viewer, claim };
}
