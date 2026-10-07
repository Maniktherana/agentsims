import { animate, useMotionValue, useTransform } from "motion/react";
import { useLayoutEffect } from "react";
import { dockPanelTransition } from "@agentsims/ui/motion/presets";
import { usePrefersReducedMotion } from "../simulator/use-prefers-reduced-motion";

/** A shared progress keeps the separate dock and tool panel aligned. */
export function useToolPanelMotion(open: boolean, height: number) {
	const reducedMotion = usePrefersReducedMotion();
	const progress = useMotionValue(open ? 1 : 0);
	const panelHeight = useMotionValue(height);
	useLayoutEffect(() => {
		panelHeight.set(height);
	}, [height, panelHeight]);
	useLayoutEffect(() => {
		const animation = animate(progress, open ? 1 : 0, {
			...dockPanelTransition,
			duration: reducedMotion ? 0 : dockPanelTransition.duration,
		});
		return () => animation.stop();
	}, [open, progress, reducedMotion]);
	return {
		panelVisibility: useTransform(() =>
			progress.get() === 0 ? "hidden" : "visible",
		),
		panelOffset: useTransform(
			() => `translateY(${(1 - progress.get()) * panelHeight.get()}px)`,
		),
		dockOffset: useTransform(
			() => `translateY(${-progress.get() * panelHeight.get()}px)`,
		),
	};
}
