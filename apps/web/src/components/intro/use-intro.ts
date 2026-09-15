import { useEffect, useState } from "react";
import { useReducedMotion, type Transition } from "motion/react";

/** The curve every intro fade shares. */
export const INTRO_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const INTRO_FADE: Transition = { duration: 0.5, ease: INTRO_EASE };
/* The iPhone carries more weight than a label, so it settles more slowly. */
export const INTRO_ENTRANCE: Transition = { duration: 0.75, ease: INTRO_EASE };

/*
 * LANDING INTRO
 * The page opens on a black laptop screen and builds itself in order.
 * Each stage adds one layer and never removes an earlier one.
 *
 * black     → nothing but the empty screen
 * screen    → the screen gradient fades up
 * copy      → hero copy staggers in, alone
 * workspace → once the copy settles, the tab label, grid, dock, and iPhone
 *             all arrive together
 * running   → the scripted demo takes over and loops
 *
 * Reduced motion goes straight to `running`.
 */
export type IntroStage = "black" | "screen" | "copy" | "workspace" | "running";

const ORDER: readonly IntroStage[] = [
	"black",
	"screen",
	"copy",
	"workspace",
	"running",
];

/*
 * Delay from the previous stage, in milliseconds. The copy holds the stage
 * for as long as its own stagger runs: the last of five lines starts at
 * 4 x 40ms and takes 500ms, so the workspace lands as that line settles.
 */
const SEQUENCE: readonly { stage: IntroStage; after: number }[] = [
	{ stage: "screen", after: 160 },
	{ stage: "copy", after: 620 },
	{ stage: "workspace", after: 700 },
	{ stage: "running", after: 520 },
];

export function useIntro() {
	const reducedMotion = useReducedMotion();
	const [stage, setStage] = useState<IntroStage>("black");

	useEffect(() => {
		if (reducedMotion) {
			setStage("running");
			return;
		}
		let elapsed = 0;
		const timers = SEQUENCE.map((step) => {
			elapsed += step.after;
			return window.setTimeout(() => setStage(step.stage), elapsed);
		});
		return () => timers.forEach((timer) => window.clearTimeout(timer));
	}, [reducedMotion]);

	return {
		stage,
		reached: (target: IntroStage) =>
			ORDER.indexOf(stage) >= ORDER.indexOf(target),
	};
}

export type Intro = ReturnType<typeof useIntro>;
