import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type KeyboardEventHandler,
	type PointerEventHandler,
} from "react";
import { simulatorResizeCornerArc } from "../../simulator/index";
import type { ResizeVisualPhase } from "../../simulator/resize/simulator-resize";
import { SimulatorResizeCornerAffordance } from "../simulator/simulator-resize-corner-handle";

export function floatingPanelResizeVisualPhase(
	dragging: boolean,
	hovered: boolean,
): ResizeVisualPhase {
	if (dragging) return "drag";
	if (hovered) return "hover";
	return "idle";
}

export function FloatingPanelResizeHandle({
	onPointerDown,
	onKeyDown,
	ariaLabel = "Resize panel",
}: {
	onPointerDown: PointerEventHandler<HTMLDivElement>;
	onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
	ariaLabel?: string;
}) {
	const handleRef = useRef<HTMLDivElement | null>(null);
	const [containerSize, setContainerSize] = useState({
		width: 540,
		height: 520,
	});
	const [hovered, setHovered] = useState(false);
	const [dragging, setDragging] = useState(false);
	const [focusVisible, setFocusVisible] = useState(false);

	useEffect(() => {
		const panel = handleRef.current?.closest<HTMLElement>(
			"[data-agentsims-floating-panel]",
		);
		if (!panel || typeof ResizeObserver === "undefined") return;
		const update = () => {
			const bounds = panel.getBoundingClientRect();
			setContainerSize({ width: bounds.width, height: bounds.height });
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(panel);
		return () => observer.disconnect();
	}, []);

	const arc = useMemo(
		() =>
			simulatorResizeCornerArc({
				type: "android",
				config: null,
				containerWidth: containerSize.width,
				containerHeight: containerSize.height,
			}),
		[containerSize],
	);
	const phase = floatingPanelResizeVisualPhase(dragging, hovered);

	return (
		<div
			ref={handleRef}
			role="separator"
			aria-label={ariaLabel}
			aria-orientation="vertical"
			tabIndex={0}
			data-agentsims-floating-panel-resize-handle
			data-resize-phase={phase}
			data-focus-visible={focusVisible}
			onPointerDown={(event) => {
				setDragging(true);
				onPointerDown(event);
			}}
			onPointerUp={() => setDragging(false)}
			onPointerCancel={() => setDragging(false)}
			onLostPointerCapture={() => setDragging(false)}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onFocus={(event) =>
				setFocusVisible(
					event.currentTarget.matches?.(":focus-visible") ?? false,
				)
			}
			onBlur={() => setFocusVisible(false)}
			onKeyDown={onKeyDown}
			style={{
				position: "absolute",
				right: -14,
				bottom: -14,
				zIndex: 50,
				display: "flex",
				width: 60,
				height: 60,
				alignItems: "flex-end",
				justifyContent: "flex-end",
				border: 0,
				padding: 0,
				margin: 0,
				background: "transparent",
				cursor: "nwse-resize",
				touchAction: "none",
				pointerEvents: "auto",
				outline: "none",
				WebkitTapHighlightColor: "transparent",
			}}
		>
			<SimulatorResizeCornerAffordance
				arc={arc}
				phase={phase}
				focusVisible={focusVisible}
			/>
		</div>
	);
}
