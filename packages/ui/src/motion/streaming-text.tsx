import { motion, useReducedMotion } from "motion/react";

const DEFAULT_WORD_DELAY = 0.06;
const DEFAULT_DURATION = 0.35;
const DEFAULT_BLUR = 1;
const STREAM_EASE = [0.22, 1, 0.36, 1] as const;

export function StreamingText({
	children,
	className,
	wordDelay = DEFAULT_WORD_DELAY,
	duration = DEFAULT_DURATION,
	blur = DEFAULT_BLUR,
}: {
	children: string;
	className?: string;
	wordDelay?: number;
	duration?: number;
	blur?: number;
}) {
	const reducedMotion = useReducedMotion();
	let wordIndex = 0;

	return (
		<span className={className} aria-label={children}>
			{children.split(/(\s+)/).map((part, index) => {
				if (/^\s+$/.test(part)) return part;
				const delay = wordIndex * wordDelay;
				wordIndex += 1;
				return (
					<motion.span
						key={`${part}-${index}`}
						aria-hidden="true"
						className="inline-block"
						initial={
							reducedMotion ? false : { opacity: 0, filter: `blur(${blur}px)` }
						}
						animate={{ opacity: 1, filter: "blur(0px)" }}
						transition={{
							duration: reducedMotion ? 0 : duration,
							delay: reducedMotion ? 0 : delay,
							ease: STREAM_EASE,
						}}
					>
						{part}
					</motion.span>
				);
			})}
		</span>
	);
}
