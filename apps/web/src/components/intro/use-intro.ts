import type { Transition } from "motion/react";

/** The curve every intro fade shares. */
const INTRO_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const INTRO_FADE: Transition = { duration: 0.5, ease: INTRO_EASE };
