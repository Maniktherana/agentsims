import {
	useLayoutEffect,
	useState,
	type CSSProperties,
	type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { motion, useIsPresent, useReducedMotion } from "motion/react";
import type { DeviceFrameDescriptor } from "../../workspace/grid";
import { WORKSPACE_DEVICE_GEOMETRY_EVENT } from "../../workspace/layout-events";
import {
	DEVICE_PRESENCE_HIDDEN_SCALE,
	DEVICE_PRESENCE_TRANSITION,
} from "../../simulator/presence-motion";

/** Paint every phone shadow below every phone, even when devices overlap. */
export function DeviceCanvasShadow({
	frame,
	chrome,
	borderRadius,
}: {
	frame: RefObject<HTMLDivElement | null>;
	chrome: DeviceFrameDescriptor | null;
	borderRadius: CSSProperties["borderRadius"];
}) {
	const present = useIsPresent();
	const reducedMotion = useReducedMotion();
	const [placement, setPlacement] = useState<{
		host: HTMLElement;
		left: number;
		top: number;
		width: number;
		height: number;
	} | null>(null);
	useLayoutEffect(() => {
		const element = frame.current;
		const device = element?.closest<HTMLElement>("[data-workspace-device]");
		const host = device
			?.closest("[data-agentsims-workspace-scroll]")
			?.querySelector<HTMLElement>("[data-agentsims-phone-shadows]");
		if (!element || !device || !host) return;
		let tick = 0;
		let until = 0;
		const measure = () => {
			const rect = element.getBoundingClientRect();
			const parent = device.getBoundingClientRect();
			const origin = host.getBoundingClientRect();
			const scale =
				new DOMMatrixReadOnly(
					getComputedStyle(device.firstElementChild!).transform,
				).a || 1;
			const width = element.offsetWidth;
			const height = element.offsetHeight;
			const left =
				parent.left +
				(rect.left - parent.left - (parent.width * (1 - scale)) / 2) / scale;
			const top =
				parent.top +
				(rect.top - parent.top - (parent.height * (1 - scale)) / 2) / scale;
			const next = {
				host,
				left:
					left -
					origin.left +
					(chrome ? (chrome.body.x / chrome.frame.width) * width : 0),
				top:
					top -
					origin.top +
					(chrome ? (chrome.body.y / chrome.frame.height) * height : 0),
				width: chrome
					? (chrome.body.width / chrome.frame.width) * width
					: width,
				height: chrome
					? (chrome.body.height / chrome.frame.height) * height
					: height,
			};
			setPlacement((current) =>
				current &&
				Math.abs(current.left - next.left) < 0.1 &&
				Math.abs(current.top - next.top) < 0.1 &&
				current.width === next.width &&
				current.height === next.height
					? current
					: next,
			);
		};
		const follow = () => {
			measure();
			tick = performance.now() < until ? requestAnimationFrame(follow) : 0;
		};
		const update = () => {
			until = performance.now() + 180;
			if (!tick) tick = requestAnimationFrame(follow);
		};
		measure();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		observer.observe(device);
		window.addEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, update);
		return () => {
			observer.disconnect();
			cancelAnimationFrame(tick);
			window.removeEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, update);
		};
	}, [frame, chrome]);
	if (!placement) return null;
	const { host, ...bounds } = placement;
	return createPortal(
		<motion.div
			data-device-canvas-shadow
			initial={{ opacity: 0, scale: DEVICE_PRESENCE_HIDDEN_SCALE }}
			animate={{
				opacity: present ? 1 : 0,
				scale: present ? 1 : DEVICE_PRESENCE_HIDDEN_SCALE,
			}}
			transition={reducedMotion ? { duration: 0 } : DEVICE_PRESENCE_TRANSITION}
			style={{
				position: "absolute",
				...bounds,
				borderRadius: chrome
					? `${(100 * chrome.outerCornerRadius) / chrome.body.width}% / ${(100 * chrome.outerCornerRadius) / chrome.body.height}%`
					: borderRadius,
				boxShadow: "0 14px 24px #0008",
			}}
		/>,
		host,
	);
}
