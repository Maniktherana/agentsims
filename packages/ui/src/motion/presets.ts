import type { Transition, Variants } from "motion/react";

export const dockSurfaceTransition = {
  type: "spring",
  bounce: 0.03,
  visualDuration: 0.15,
} satisfies Transition;

export const dockPanelVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction * 16,
    filter: "blur(4px)",
  }),
  center: { opacity: 1, x: 0, filter: "blur(0px)" },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction * -16,
    filter: "blur(4px)",
  }),
} satisfies Variants;

export const dockPanelTransition = {
  duration: 0.24,
  ease: [0, 0, 0.2, 1],
} satisfies Transition;
