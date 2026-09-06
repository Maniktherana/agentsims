import { useLayoutEffect, useState, type RefObject } from "react";
/** Measure the frame's usable area; title and actions are deducted exactly once. */
export function useSimulatorBounds(
	stack: RefObject<HTMLDivElement | null>,
	frame: RefObject<HTMLDivElement | null>,
) {
	const [bounds, setBounds] = useState({
		width: typeof window === "undefined" ? 1280 : window.innerWidth - 48,
		height: typeof window === "undefined" ? 664 : window.innerHeight - 136,
	});
	useLayoutEffect(() => {
		const stackElement = stack.current;
		const frameElement = frame.current;
		if (!stackElement || !frameElement) return;
		const canvas =
			stackElement.closest<HTMLElement>("[data-agentsims-workspace-scroll]") ??
			stackElement.parentElement;
		if (!canvas) return;
		const measure = () => {
			const style = getComputedStyle(canvas);
			const stackStyle = getComputedStyle(stackElement);
			const children = Array.from(stackElement.children).filter(
				(child) =>
					!["absolute", "fixed"].includes(getComputedStyle(child).position),
			);
			const chrome =
				children
					.filter((child) => child !== frameElement)
					.reduce(
						(sum, child) => sum + child.getBoundingClientRect().height,
						0,
					) +
				Math.max(0, children.length - 1) * parseFloat(stackStyle.rowGap || "0");
			const fullscreen = document.fullscreenElement === stackElement;
			const next = {
				width: fullscreen
					? Math.max(1, window.innerWidth - 32)
					: Math.max(
							1,
							canvas.clientWidth -
								parseFloat(style.paddingLeft || "0") -
								parseFloat(style.paddingRight || "0"),
						),
				height: fullscreen
					? Math.max(1, window.innerHeight - chrome - 32)
					: Math.max(
							1,
							canvas.clientHeight -
								parseFloat(style.paddingTop || "0") -
								parseFloat(style.paddingBottom || "0") -
								chrome,
						),
			};
			setBounds((current) =>
				Math.abs(current.width - next.width) < 0.5 &&
				Math.abs(current.height - next.height) < 0.5
					? current
					: next,
			);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(canvas);
		observer.observe(stackElement);
		observer.observe(frameElement);
		document.addEventListener("fullscreenchange", measure);
		return () => {
			observer.disconnect();
			document.removeEventListener("fullscreenchange", measure);
		};
	}, [stack, frame]);
	return bounds;
}
