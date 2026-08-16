import { memo, useRef } from "react";
import type { AxElement } from "../../../accessibility/model";
import {
	axElementKey,
	axElementsEqual,
	axFrameString,
	axNodeForElement,
	clampAxFrameForScreen,
} from "../../accessibility/ax";

function axElementHoverLabel(element: AxElement): string {
	const generatedLabel = /^ags_[a-z0-9_-]+$/i.test(
		(element.label || "").trim(),
	);
	return (
		(!generatedLabel ? element.label : "") ||
		element.source?.componentName ||
		element.source?.elementName ||
		element.role ||
		element.type ||
		"Accessibility element"
	);
}

export interface AxTargetProps {
	element: AxElement;
	index: number;
	screen: { width: number; height: number };
	highlighted: boolean;
	selected: boolean;
	interactive?: boolean;
	outlined?: boolean;
	onHighlight: (key: string | null) => void;
	onSelect: (key: string) => void;
	onPick?: (key: string) => void;
}

export interface AxTargetVisualStyle {
	borderColor: string;
	background: string;
	borderWidth: number;
}

/** The established simulator overlay palette, shared by iOS and Android. */
export function axTargetVisualStyle({
	highlighted,
	selected,
	outlined,
}: {
	hasSource: boolean;
	highlighted: boolean;
	selected: boolean;
	outlined: boolean;
}): AxTargetVisualStyle {
	return {
		borderWidth: 1,
		borderColor: selected
			? "#60a5fa"
			: highlighted
				? "#fbbf24"
				: outlined
					? "#34d399"
					: "transparent",
		background: selected
			? "rgba(96,165,250,0.24)"
			: highlighted
				? "rgba(245,158,11,0.28)"
				: outlined
					? "rgba(16,185,129,0.12)"
					: "transparent",
	};
}

export function axTargetSpecificityLayer(
	frame: { width: number; height: number },
	screen: { width: number; height: number },
): number {
	const areaRatio = Math.min(
		1,
		(frame.width * frame.height) / Math.max(1, screen.width * screen.height),
	);
	return Math.max(1, Math.round((1 - areaRatio) * 10_000));
}

export function axTargetStackingLayer({
	interactive: _interactive,
	selected,
	highlighted,
	specificityLayer,
}: {
	interactive: boolean;
	selected: boolean;
	highlighted: boolean;
	specificityLayer: number;
}): number {
	if (selected) return 30_000;
	if (highlighted) return 20_000;
	return specificityLayer;
}

/**
 * Keep the phone-hover contract in one place so every native pointer entry,
 * movement, and exit produces the same canonical overlay highlight.
 */
export function axTargetPointerHandlers(
	key: string,
	onHighlight: (key: string | null) => void,
) {
	return {
		onPointerEnter: () => onHighlight(key),
		onPointerMove: () => onHighlight(key),
		onPointerLeave: () => onHighlight(null),
	};
}

export const AxTarget = memo(
	function AxTarget({
		element,
		index,
		screen,
		highlighted,
		selected,
		interactive = true,
		outlined = false,
		onHighlight,
		onSelect,
		onPick,
	}: AxTargetProps) {
		const handlersRef = useRef({ onHighlight, onSelect, onPick });
		handlersRef.current = { onHighlight, onSelect, onPick };
		const key = axElementKey(element);
		const axNode = axNodeForElement(element, index);
		const visibleFrame = clampAxFrameForScreen(element.frame, screen);
		if (!visibleFrame) return null;
		const pointerHandlers = axTargetPointerHandlers(key, (highlightedKey) =>
			handlersRef.current.onHighlight(highlightedKey),
		);

		const specificityLayer = axTargetSpecificityLayer(visibleFrame, screen);
		const visualStyle = axTargetVisualStyle({
			hasSource: Boolean(element.source),
			highlighted,
			selected,
			outlined,
		});
		return (
			<button
				type="button"
				data-ax-key={key}
				data-ax-id={axNode.id}
				data-ax-path={axNode.path}
				data-ax-label={axNode.label}
				data-ax-value={axNode.value}
				data-ax-role={axNode.role}
				data-ax-type={axNode.type}
				data-ax-enabled={String(axNode.enabled)}
				data-ax-frame={axFrameString(axNode.frame)}
				data-ax-selected={String(selected)}
				aria-label={axElementHoverLabel(element)}
				aria-hidden={!interactive}
				tabIndex={-1}
				onClick={(event) => {
					event.preventDefault();
					event.stopPropagation();
					handlersRef.current.onSelect(key);
					handlersRef.current.onPick?.(key);
				}}
				// Pointer entry handles the common stationary-cursor path when Select
				// arms; move covers an already-active pointer. Full-screen carriers are
				// filtered out before this component mounts.
				onPointerEnter={pointerHandlers.onPointerEnter}
				onPointerMove={pointerHandlers.onPointerMove}
				onPointerLeave={pointerHandlers.onPointerLeave}
				className={`absolute box-border min-h-px min-w-px rounded-[3px] border p-0 outline-none focus:outline-none [transition-property:border-color,background-color] duration-[120ms] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${
					interactive
						? "cursor-pointer pointer-events-auto"
						: "cursor-default pointer-events-none"
				} ${selected ? "agentsims-target-lock-enter" : ""}`}
				style={{
					left: `${(visibleFrame.x / screen.width) * 100}%`,
					top: `${(visibleFrame.y / screen.height) * 100}%`,
					width: `${(visibleFrame.width / screen.width) * 100}%`,
					height: `${(visibleFrame.height / screen.height) * 100}%`,
					zIndex: axTargetStackingLayer({
						interactive,
						selected,
						highlighted,
						specificityLayer,
					}),
					...visualStyle,
				}}
			/>
		);
	},
	(prev, next) =>
		prev.index === next.index &&
		prev.highlighted === next.highlighted &&
		prev.selected === next.selected &&
		prev.interactive === next.interactive &&
		prev.outlined === next.outlined &&
		prev.onHighlight === next.onHighlight &&
		prev.onSelect === next.onSelect &&
		prev.onPick === next.onPick &&
		prev.screen.width === next.screen.width &&
		prev.screen.height === next.screen.height &&
		axElementsEqual(prev.element, next.element),
);
