import { Button } from "@agentsims/ui/components/button";
import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";
import {
	motion,
	useIsPresent,
	useReducedMotion,
	type HTMLMotionProps,
} from "motion/react";

const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

/** Shared floating-panel reveal; its caller retains it with AnimatePresence. */
export function PanelSurface({ style, ...props }: HTMLMotionProps<"aside">) {
	const reducedMotion = useReducedMotion();
	const present = useIsPresent();
	return (
		<motion.aside
			{...props}
			initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
			animate={{ opacity: 1, scale: 1 }}
			exit={{
				opacity: 0,
				scale: reducedMotion ? 1 : 0.96,
				transition: { duration: reducedMotion ? 0 : 0.15, ease: PANEL_EASE },
			}}
			transition={{ duration: reducedMotion ? 0 : 0.25, ease: PANEL_EASE }}
			style={{
				transformOrigin: "center",
				...style,
				pointerEvents: present ? style?.pointerEvents : "none",
			}}
		/>
	);
}

export function Panel({
	open,
	width,
	children,
	style,
	side = "right",
}: {
	open: boolean;
	width: number;
	children: ReactNode;
	style?: CSSProperties;
	side?: "left" | "right";
}) {
	const reducedMotion = useReducedMotion();
	const chromeClass =
		side === "left"
			? "top-0 bottom-0 left-0 rounded-none border-0 border-r border-white/10 shadow-[8px_0_32px_rgba(0,0,0,0.35)]"
			: "top-3 bottom-[72px] right-3 rounded-[10px] border border-white/10 shadow-[var(--agentsims-shadow-panel)]";

	return (
		<motion.aside
			initial={false}
			animate={{
				opacity: open ? 1 : 0,
				scale: open || reducedMotion ? 1 : 0.96,
			}}
			transition={{
				duration: reducedMotion ? 0 : open ? 0.25 : 0.15,
				ease: PANEL_EASE,
			}}
			data-state={open ? "open" : "closed"}
			className={`agentsims-side-panel fixed z-35 flex min-w-0 flex-col overflow-hidden bg-panel-bg text-white/90 [font-family:-apple-system,system-ui,sans-serif] ${chromeClass}`}
			style={{
				width,
				transformOrigin: "center",
				pointerEvents: open ? "auto" : "none",
				...style,
			}}
			aria-hidden={!open}
			inert={!open}
		>
			{children}
		</motion.aside>
	);
}

export function PanelHeader({
	children,
	style,
}: {
	children: ReactNode;
	style?: CSSProperties;
}) {
	return (
		<header
			className="flex h-11 shrink-0 items-center justify-between gap-2.5 border-b border-white/[0.07] px-2 pl-3"
			style={style}
		>
			{children}
		</header>
	);
}

export function PanelTitle({ children }: { children: ReactNode }) {
	return (
		<span className="text-[11px] font-medium text-white/55">{children}</span>
	);
}

export function PanelCloseButton({
	onClick,
	ariaLabel = "Close panel",
	title,
	iconSize = 16,
}: {
	onClick: () => void;
	ariaLabel?: string;
	title?: string;
	iconSize?: number;
}) {
	return (
		<Button
			variant="unstyled" size="unstyled"
			type="button"
			onClick={onClick}
			className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent p-0 text-[#8e8e93] [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard),color_var(--agentsims-duration-hover)_var(--agentsims-ease-standard),transform_var(--agentsims-duration-press)_var(--agentsims-ease-standard)] hover:bg-white/8 hover:text-white active:scale-[0.96] motion-reduce:transition-none"
			aria-label={ariaLabel}
			title={title}
		>
			<X size={iconSize} strokeWidth={2} />
		</Button>
	);
}
