import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type CSSProperties, type ReactNode } from "react";

interface SwapProps {
	state: string | number;
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}

const ICON_HIDDEN = { opacity: 0, filter: "blur(2px)", scale: 0.25 };
const ICON_VISIBLE = { opacity: 1, filter: "blur(0px)", scale: 1 };

/** Overlap the outgoing and incoming icon without changing the icon's slot. */
export function IconSwap({ state, children, className, style }: SwapProps) {
	const reducedMotion = useReducedMotion();
	return (
		<span className={className} style={{ display: "inline-grid", ...style }}>
			<AnimatePresence initial={false}>
				<motion.span
					key={state}
					initial={reducedMotion ? false : ICON_HIDDEN}
					animate={ICON_VISIBLE}
					exit={reducedMotion ? { opacity: 0 } : ICON_HIDDEN}
					transition={{ duration: reducedMotion ? 0 : 0.25, ease: "easeInOut" }}
					style={{ gridArea: "1 / 1", display: "grid", placeItems: "center" }}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
