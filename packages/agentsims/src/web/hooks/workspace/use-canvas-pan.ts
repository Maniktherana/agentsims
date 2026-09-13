import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type PointerEvent,
	type RefObject,
} from "react";
import {
	canvasCenterDelta,
	canvasViewOffset,
} from "../../workspace/canvas-view";
import type { CanvasPan } from "../../workspace/url-state";

export function moveView(
	element: HTMLDivElement,
	x: number,
	y: number,
	scroll = { left: element.scrollLeft, top: element.scrollTop },
) {
	const offset = canvasViewOffset(element);
	const content = element.querySelector<HTMLElement>(
		"[data-agentsims-canvas-content]",
	);
	for (const target of [content, element]) {
		for (const animation of target?.getAnimations() ?? []) animation.cancel();
	}
	// Fold native scrolling into the view before translating so scroll bounds
	// cannot clamp the camera when it crosses the original content edge.
	const next = {
		x: offset.x + x - scroll.left,
		y: offset.y + y - scroll.top,
	};
	element.dataset.canvasPanX = String(next.x);
	element.dataset.canvasPanY = String(next.y);
	if (content) content.style.transform = `translate(${next.x}px, ${next.y}px)`;
	element.style.backgroundPosition = `${next.x}px ${next.y}px`;
	element.scrollTo({ left: 0, top: 0, behavior: "instant" });
}

export function animateView(element: HTMLDivElement, x: number, y: number) {
	moveView(element, 0, 0);
	const from = canvasViewOffset(element);
	moveView(element, x, y);
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	const to = canvasViewOffset(element);
	const options = {
		duration: Math.min(320, 200 + Math.hypot(x, y) * 0.08),
		easing: "cubic-bezier(0.23, 1, 0.32, 1)",
	};
	element
		.querySelector<HTMLElement>("[data-agentsims-canvas-content]")
		?.animate(
			{
				transform: [
					`translate(${from.x}px, ${from.y}px)`,
					`translate(${to.x}px, ${to.y}px)`,
				],
			},
			options,
		);
	element.animate(
		{ backgroundPosition: [`${from.x}px ${from.y}px`, `${to.x}px ${to.y}px`] },
		options,
	);
}

export function useCanvasPan(
	canvas: RefObject<HTMLDivElement | null>,
	visibleRevision: string,
	initialPan: CanvasPan,
	onPanCommit: (pan: CanvasPan) => void,
) {
	const [panMode, setPanMode] = useState(false);
	const [panning, setPanning] = useState(false);
	const pointer = useRef<{
		id: number;
		x: number;
		y: number;
		time: number;
		vx: number;
		vy: number;
	} | null>(null);
	const lastScroll = useRef<{
		element: HTMLDivElement | null;
		left: number;
		top: number;
	}>({ element: null, left: 0, top: 0 });
	const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const commit = useCallback(
		(delay = 0) => {
			if (commitTimer.current) clearTimeout(commitTimer.current);
			commitTimer.current = setTimeout(() => {
				commitTimer.current = null;
				onPanCommit(canvasViewOffset(canvas.current));
			}, delay);
		},
		[canvas, onPanCommit],
	);
	useLayoutEffect(() => {
		const element = canvas.current;
		if (!element) return;
		const current = canvasViewOffset(element);
		moveView(element, initialPan.x - current.x, initialPan.y - current.y);
	}, [canvas, initialPan.x, initialPan.y, visibleRevision]);
	useEffect(
		() => () => {
			if (commitTimer.current) clearTimeout(commitTimer.current);
		},
		[],
	);
	const rememberScroll = useCallback(() => {
		const element = canvas.current;
		lastScroll.current = {
			element,
			left: element?.scrollLeft ?? 0,
			top: element?.scrollTop ?? 0,
		};
	}, [canvas]);
	useLayoutEffect(() => {
		const element = canvas.current;
		if (element && lastScroll.current.element === element) {
			// Removing a large phone can clamp native scroll before this effect.
			// Preserve the prior view, not that newly clamped scroll position.
			moveView(element, 0, 0, lastScroll.current);
		}
		rememberScroll();
		element?.addEventListener("scroll", rememberScroll, { passive: true });
		return () => element?.removeEventListener("scroll", rememberScroll);
	}, [canvas, rememberScroll, visibleRevision]);
	const stop = useCallback(() => {
		const id = pointer.current?.id;
		pointer.current = null;
		if (id !== undefined && canvas.current?.hasPointerCapture(id))
			canvas.current.releasePointerCapture(id);
		setPanning(false);
	}, [canvas]);
	useEffect(() => {
		const escape = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			stop();
			setPanMode(false);
		};
		window.addEventListener("blur", stop);
		window.addEventListener("keydown", escape);
		return () => {
			window.removeEventListener("blur", stop);
			window.removeEventListener("keydown", escape);
		};
	}, [stop]);
	const onPointerDownCapture = (event: PointerEvent<HTMLDivElement>) => {
		const target = event.target as HTMLElement;
		if (
			!event.currentTarget.contains(target) ||
			pointer.current ||
			!event.isPrimary
		)
			return;
		if (
			target.closest(
				"[data-agentsims-floating-panel],button,input,select,textarea,a,[contenteditable=true]",
			)
		)
			return;
		if (event.button !== 0 && event.button !== 1) return;
		if (
			!panMode &&
			event.button !== 1 &&
			target.closest("[data-workspace-device]")
		)
			return;
		event.preventDefault();
		event.stopPropagation();
		pointer.current = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			time: event.timeStamp,
			vx: 0,
			vy: 0,
		};
		moveView(event.currentTarget, 0, 0);
		rememberScroll();
		event.currentTarget.setPointerCapture(event.pointerId);
		setPanning(true);
	};
	const onPointerMoveCapture = (event: PointerEvent<HTMLDivElement>) => {
		const previous = pointer.current;
		if (!previous || previous.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		moveView(
			event.currentTarget,
			event.clientX - previous.x,
			event.clientY - previous.y,
		);
		rememberScroll();
		pointer.current = {
			id: event.pointerId,
			x: event.clientX,
			y: event.clientY,
			time: event.timeStamp,
			vx:
				(event.clientX - previous.x) /
				Math.max(8, event.timeStamp - previous.time),
			vy:
				(event.clientY - previous.y) /
				Math.max(8, event.timeStamp - previous.time),
		};
	};
	const onPointerUpCapture = (event: PointerEvent<HTMLDivElement>) => {
		const last = pointer.current;
		if (!last || last.id !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		stop();
		if (
			event.type === "pointerup" &&
			event.timeStamp - last.time < 80 &&
			!window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			const speed = Math.hypot(last.vx, last.vy);
			if (speed > 0.15) {
				const travel = Math.min(100, speed * 70);
				animateView(
					event.currentTarget,
					(last.vx / speed) * travel,
					(last.vy / speed) * travel,
				);
				rememberScroll();
			}
		}
		commit(180);
	};
	useEffect(() => {
		const element = canvas.current;
		if (!element) return;
		const wheel = (event: WheelEvent) => {
			const target = event.target as HTMLElement;
			if (
				target.closest(
					"[data-agentsims-floating-panel],input,select,textarea,[contenteditable=true]",
				)
			)
				return;
			if (!panMode && target.closest("[data-workspace-device]")) return;
			event.preventDefault();
			event.stopPropagation();
			const unit =
				event.deltaMode === 1
					? 16
					: event.deltaMode === 2
						? element.clientHeight
						: 1;
			moveView(
				element,
				-(event.shiftKey ? event.deltaY : event.deltaX) * unit,
				event.shiftKey ? 0 : -event.deltaY * unit,
			);
			rememberScroll();
			commit(180);
		};
		element.addEventListener("wheel", wheel, { capture: true, passive: false });
		return () => element.removeEventListener("wheel", wheel, true);
	}, [canvas, panMode, rememberScroll, visibleRevision]);
	const recenter = () => {
		const element = canvas.current;
		if (!element) return;
		const origin = element.getBoundingClientRect();
		const rects = Array.from(
			element.querySelectorAll<HTMLElement>("[data-workspace-device]"),
			(device) => {
				const rect = device.getBoundingClientRect();
				const x = -origin.left - element.clientLeft;
				const y = -origin.top - element.clientTop;
				return {
					left: rect.left + x,
					top: rect.top + y,
					right: rect.right + x,
					bottom: rect.bottom + y,
				};
			},
		);
		const delta = canvasCenterDelta(rects, {
			width: element.clientWidth,
			height: element.clientHeight,
		});
		if (delta) {
			animateView(element, delta.x, delta.y);
			rememberScroll();
			commit(320);
		}
	};
	return {
		panMode,
		panning,
		togglePan: () => setPanMode((value) => !value),
		recenter,
		handlers: {
			onPointerDownCapture,
			onPointerMoveCapture,
			onPointerUpCapture,
			onPointerCancelCapture: onPointerUpCapture,
			onLostPointerCapture: stop,
		},
	};
}
