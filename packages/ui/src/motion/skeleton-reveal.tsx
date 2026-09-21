import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

const REVEAL_DURATION = 0.4;
const REVEAL_BLUR = 2;

export function SkeletonReveal({
	loading,
	skeleton,
	children,
	className,
}: {
	loading: boolean;
	skeleton: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	const reducedMotion = useReducedMotion();
	const transition = {
		duration: reducedMotion || loading ? 0 : REVEAL_DURATION,
		ease: "easeInOut" as const,
	};

	return (
		<div className={className} style={{ display: "grid" }}>
			<motion.div
				aria-hidden={!loading}
				inert={!loading}
				animate={{
					opacity: loading ? 1 : 0,
					filter: loading ? "blur(0px)" : `blur(${REVEAL_BLUR}px)`,
				}}
				transition={transition}
				style={{ gridArea: "1 / 1", pointerEvents: loading ? "auto" : "none" }}
			>
				{skeleton}
			</motion.div>
			<motion.div
				aria-hidden={loading}
				inert={loading}
				animate={{
					opacity: loading ? 0 : 1,
					filter: loading ? `blur(${REVEAL_BLUR}px)` : "blur(0px)",
				}}
				transition={transition}
				style={{ gridArea: "1 / 1", pointerEvents: loading ? "none" : "auto" }}
			>
				{children}
			</motion.div>
		</div>
	);
}
