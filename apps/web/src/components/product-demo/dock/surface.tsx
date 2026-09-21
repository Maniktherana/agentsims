import {
	useLayoutEffect,
	useRef,
	useState,
	type KeyboardEventHandler,
	type ReactNode,
	type RefObject,
} from "react";
import { MotionConfig, motion } from "motion/react";
import { dockSurfaceTransition } from "@agentsims/ui/motion/presets";

/** Animated surface for the landing demo dock. */
export function WorkspaceDockSurface({
	id,
	panelRef,
	onKeyDown,
	expanded,
	width: dockWidth,
	height: dockHeight,
	children,
	controls,
}: {
	id?: string;
	panelRef?: RefObject<HTMLDivElement | null>;
	onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
	expanded: boolean;
	width: number;
	height: number;
	children: ReactNode;
	controls: ReactNode;
}) {
	const [dockWidthAnimating, setDockWidthAnimating] = useState(false);
	const previousDockWidthRef = useRef<number | null>(null);

	useLayoutEffect(() => {
		const previousWidth = previousDockWidthRef.current;
		previousDockWidthRef.current = dockWidth;
		if (previousWidth !== null && previousWidth !== dockWidth) {
			setDockWidthAnimating(true);
		}
	}, [dockWidth]);

	return (
		<MotionConfig reducedMotion="user" transition={dockSurfaceTransition}>
			<motion.div
				data-agentsims-floating-panel
				id={id}
				ref={panelRef}
				role="toolbar"
				aria-label="Workspace"
				onKeyDown={onKeyDown}
				data-expanded={expanded ? "true" : "false"}
				initial={false}
				animate={{
					width: dockWidth,
					height: dockHeight,
					borderRadius: expanded ? 16 : 10,
				}}
				onAnimationComplete={() => setDockWidthAnimating(false)}
				className="pointer-events-auto absolute bottom-0 left-1/2 flex -translate-x-1/2 flex-col overflow-visible border border-white/[0.1] bg-[oklch(0.209036_0_0)] shadow-[0_18px_56px_oklch(0_0_0/0.5)]"
			>
				<motion.div
					aria-hidden={!expanded}
					initial={false}
					animate={{
						opacity: expanded ? 1 : 0,
						y: expanded ? 0 : 8,
						filter: expanded ? "blur(0px)" : "blur(3px)",
					}}
					transition={{
						duration: expanded ? 0.1 : 0.07,
						delay: expanded ? 0.015 : 0,
					}}
					className={`relative min-h-0 flex-1 overflow-hidden rounded-t-[15px] ${expanded ? "" : "pointer-events-none"}`}
				>
					{children}
				</motion.div>
				<div
					className={`flex h-12 w-full min-w-0 shrink-0 items-center justify-center gap-1 p-1 ${dockWidthAnimating ? "overflow-x-clip overflow-y-visible" : "overflow-visible"}`}
				>
					{controls}
				</div>
			</motion.div>
		</MotionConfig>
	);
}
