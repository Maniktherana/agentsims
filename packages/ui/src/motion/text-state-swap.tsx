import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

const DURATION = 0.15;
const DISTANCE = 4;
const BLUR = 2;

export function TextStateSwap({
	children,
	className,
	style,
}: {
	children: ReactNode;
	className?: string;
	style?: CSSProperties;
}) {
	const reducedMotion = useReducedMotion();
	const key =
		typeof children === "string" || typeof children === "number"
			? String(children)
			: undefined;

	return (
		<span
			className={className}
			style={{ display: "inline-grid", minWidth: 0, ...style }}
		>
			<AnimatePresence initial={false} mode="wait">
				<motion.span
					key={key}
					initial={
						reducedMotion
							? false
							: { y: DISTANCE, filter: `blur(${BLUR}px)`, opacity: 0 }
					}
					animate={{ y: 0, filter: "blur(0px)", opacity: 1 }}
					exit={
						reducedMotion
							? { opacity: 0 }
							: { y: -DISTANCE, filter: `blur(${BLUR}px)`, opacity: 0 }
					}
					transition={{
						duration: reducedMotion ? 0 : DURATION,
						ease: "easeInOut",
					}}
					style={{ gridArea: "1 / 1", minWidth: 0 }}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}
