import { useLayoutEffect, useRef, type RefObject } from "react";
import {
	panelPhoneTranslation,
	WORKSPACE_DOCK_CLEARANCE,
} from "../../workspace/phone-fit";
import { WORKSPACE_DEVICE_GEOMETRY_EVENT } from "../../workspace/layout-events";

/** Fit on geometry changes; normal dragging and panning stay independent. */
export function usePanelPhonePlacement(
	element: RefObject<HTMLDivElement | null>,
	bottomInset: number,
) {
	const correction = useRef(0);
	useLayoutEffect(() => {
		const target = element.current;
		if (!target) return;
		if (bottomInset <= WORKSPACE_DOCK_CLEARANCE) {
			const changed = correction.current !== 0;
			target.style.translate = "";
			correction.current = 0;
			if (changed)
				window.dispatchEvent(new Event(WORKSPACE_DEVICE_GEOMETRY_EVENT));
			return;
		}
		const measure = () => {
			const rect = target.getBoundingClientRect();
			const next = panelPhoneTranslation(
				rect.top - correction.current,
				rect.height,
				window.innerHeight,
				bottomInset,
			);
			if (Math.abs(next - correction.current) < 0.5) return;
			correction.current = next;
			target.style.translate = `0 ${next}px`;
			window.dispatchEvent(new Event(WORKSPACE_DEVICE_GEOMETRY_EVENT));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(target);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [element, bottomInset]);
}
