import { useLayoutEffect, useState, type RefObject } from "react";
import type { AnnotationGeometry } from "../../annotation/contracts";
import { WORKSPACE_DEVICE_GEOMETRY_EVENT } from "../../workspace/layout-events";

/** Read the presented screen rectangle when workspace geometry changes. */
export function usePhoneScreenGeometry(
	screen: RefObject<HTMLDivElement | null>,
	{ active = true, deviceId }: { active?: boolean; deviceId?: string } = {},
) {
	const [geometry, setGeometry] = useState<AnnotationGeometry | null>(null);
	useLayoutEffect(() => {
		if (!active) return;
		const element = screen.current;
		if (!element) return;
		let disposed = false;
		const measure = () => {
			if (disposed) return;
			const rect = element.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			setGeometry((previous) => {
				const old = previous?.viewport;
				if (
					old &&
					old.x === rect.x &&
					old.y === rect.y &&
					old.width === rect.width &&
					old.height === rect.height
				)
					return previous;
				return {
					viewport: {
						x: rect.x,
						y: rect.y,
						width: rect.width,
						height: rect.height,
					},
					image: { width: rect.width, height: rect.height },
					axScreen: { width: rect.width, height: rect.height },
				};
			});
		};
		measure();
		const resize = new ResizeObserver(measure);
		resize.observe(element);
		const mutation = new MutationObserver(measure);
		const content = element.closest("[data-agentsims-canvas-content]");
		if (content)
			mutation.observe(content, {
				attributes: true,
				attributeFilter: ["style"],
			});
		const onGeometry = (event: Event) => {
			const detail = (event as CustomEvent<{ deviceId?: string }>).detail;
			if (!detail?.deviceId || !deviceId || detail.deviceId === deviceId)
				measure();
		};
		window.addEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
		window.addEventListener("resize", measure);
		window.addEventListener("scroll", measure, true);
		return () => {
			disposed = true;
			resize.disconnect();
			mutation.disconnect();
			window.removeEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
			window.removeEventListener("resize", measure);
			window.removeEventListener("scroll", measure, true);
		};
	}, [screen, active, deviceId]);
	return geometry;
}
