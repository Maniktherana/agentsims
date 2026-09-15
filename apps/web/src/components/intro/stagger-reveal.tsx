import {
	MotionConfig,
	motion,
	useReducedMotion,
	type Variants,
} from "motion/react";
import { useRef, type ReactNode } from "react";
import { INTRO_EASE } from "./use-intro";

const DURATION = 0.5;
const DISTANCE = 12;
const STAGGER = 0.04;
const BLUR = 3;
const EXIT_DURATION = 0.2;
const EASE = INTRO_EASE;

export const staggerContainer = {
	hidden: {},
	shown: { transition: { staggerChildren: STAGGER } },
	hiding: { transition: { staggerChildren: 0 } },
} satisfies Variants;

export const staggerLine = {
	hidden: { opacity: 0, y: DISTANCE, filter: `blur(${BLUR}px)` },
	shown: {
		opacity: 1,
		y: 0,
		filter: "blur(0px)",
		transition: { duration: DURATION, ease: EASE },
	},
	hiding: {
		opacity: 0,
		y: 0,
		filter: "blur(0px)",
		transition: {
			opacity: { duration: EXIT_DURATION, ease: "easeInOut" },
			y: { duration: 0 },
			filter: { duration: 0 },
		},
	},
} satisfies Variants;

const TAGS = {
	div: motion.div,
	p: motion.p,
	h1: motion.h1,
	span: motion.span,
	strong: motion.strong,
} as const;

export function StaggerLine({
	as = "div",
	className,
	children,
}: {
	as?: keyof typeof TAGS;
	className?: string;
	children?: ReactNode;
}) {
	const Tag = TAGS[as];
	return (
		<Tag className={className} variants={staggerLine}>
			{children}
		</Tag>
	);
}

export function StaggerReveal({
	show,
	className,
	children,
}: {
	show: boolean;
	className?: string;
	children: ReactNode;
}) {
	const reducedMotion = useReducedMotion();
	const shownOnce = useRef(false);
	if (show) shownOnce.current = true;
	const state = show ? "shown" : shownOnce.current ? "hiding" : "hidden";
	return (
		<MotionConfig reducedMotion="user">
			<motion.div
				className={className}
				variants={staggerContainer}
				initial={reducedMotion ? false : "hidden"}
				animate={state}
			>
				{children}
			</motion.div>
		</MotionConfig>
	);
}
