import { useRef } from "react";
import { useInView, type UseInViewOptions } from "motion/react";

const PLAYBACK_MARGIN =
	"0px 0px -30% 0px" satisfies UseInViewOptions["margin"];

/**
 * Starts playback when the trigger crosses 70% down the viewport.
 * The trigger line does not depend on the height of the content.
 */
export function useViewportPlayback<T extends Element>() {
	const ref = useRef<T>(null);
	const inView = useInView(ref, {
		amount: "some",
		margin: PLAYBACK_MARGIN,
	});

	return [ref, inView] as const;
}
