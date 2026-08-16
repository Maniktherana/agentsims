import {
	Accessibility as AccessibilityIcon,
	GripVertical,
	X,
} from "lucide-react";
import {
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
	type KeyboardEventHandler,
	type PointerEventHandler,
	type ReactNode,
} from "react";
import { IconButton } from "../ui/icon-button";
import { SimulatorResizeCornerAffordance } from "../simulator/simulator-resize-corner-handle";
import { simulatorResizeCornerArc } from "../../simulator/index";
import type { ResizeVisualPhase } from "../../simulator/resize/simulator-resize";

export interface AccessibilityDeviceIdentity {
	id: string;
	name: string;
	platform: "ios" | "android";
	runtime?: string | null;
	applicationName?: string | null;
	connected?: boolean;
}

export interface AccessibilityPanelProps {
	open: boolean;
	device: AccessibilityDeviceIdentity;
	onClose: () => void;
	children: ReactNode;
	placement?: "side" | "bottom";
	headerActions?: ReactNode;
	footer?: ReactNode;
	className?: string;
	bodyClassName?: string;
	onMovePointerDown?: PointerEventHandler<HTMLElement>;
	onResizePointerDown?: PointerEventHandler<HTMLDivElement>;
	onResizeKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}

export function shouldStartAccessibilityHeaderDrag(target: unknown): boolean {
	const closest = (target as { closest?: (selector: string) => unknown } | null)
		?.closest;
	return typeof closest !== "function" || !closest.call(target, "button");
}

export function accessibilityResizeVisualPhase(
	dragging: boolean,
	hovered: boolean,
): ResizeVisualPhase {
	if (dragging) return "drag";
	if (hovered) return "hover";
	return "idle";
}

function AccessibilityResizeCornerHandle({
	onPointerDown,
	onKeyDown,
}: {
	onPointerDown: PointerEventHandler<HTMLDivElement>;
	onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
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
			"[data-accessibility-panel]",
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
	const phase = accessibilityResizeVisualPhase(dragging, hovered);

	return (
		<div
			ref={handleRef}
			role="separator"
			aria-label="Resize accessibility panel"
			aria-orientation="vertical"
			tabIndex={0}
			data-agentsims-accessibility-resize-handle
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

export function AccessibilityPanel({
	open,
	device,
	onClose,
	children,
	placement = "side",
	headerActions,
	footer,
	className = "",
	bodyClassName = "",
	onMovePointerDown,
	onResizePointerDown,
	onResizeKeyDown,
}: AccessibilityPanelProps) {
	const titleId = useId();
	if (!open) return null;

	const title = "Accessibility";
	const identityTooltip = [
		title,
		device.platform === "ios" ? "iOS" : "Android",
		device.name,
		device.runtime,
		device.applicationName,
	]
		.filter(Boolean)
		.join(" · ");
	const placementClass =
		placement === "side"
			? "h-full min-h-0 w-full"
			: "max-h-[440px] min-h-[320px] w-full";

	return (
		<aside
			aria-labelledby={titleId}
			data-device-id={device.id}
			data-device-platform={device.platform}
			data-accessibility-panel
			className={`agentsims-accessibility-panel-enter relative flex min-w-0 flex-col overflow-visible rounded-[14px] border border-white/[0.1] bg-[var(--agentsims-panel-bg,#181818)] text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)] ${placementClass} ${className}`}
		>
			<header
				data-agentsims-accessibility-panel-header
				data-agentsims-accessibility-drag-handle={
					onMovePointerDown ? "true" : undefined
				}
				onPointerDown={
					onMovePointerDown
						? (event) => {
								if (!shouldStartAccessibilityHeaderDrag(event.target)) return;
								onMovePointerDown(event);
							}
						: undefined
				}
				className={`flex h-10 shrink-0 select-none items-center gap-1.5 px-2 ${
					onMovePointerDown ? "cursor-grab active:cursor-grabbing" : ""
				}`}
			>
				{onMovePointerDown && (
					<GripVertical
						aria-hidden="true"
						size={12}
						strokeWidth={1.8}
						className="-mr-1 shrink-0 text-white/25"
					/>
				)}
				<span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/58">
					<AccessibilityIcon size={14} strokeWidth={1.9} />
				</span>
				<h2 id={titleId} className="sr-only">
					{title}
				</h2>
				<div
					className="flex min-w-0 flex-1 items-center gap-1.5"
					title={identityTooltip}
				>
					<span
						aria-label={device.connected ? "Live" : "Disconnected"}
						className={`size-1.5 shrink-0 rounded-full ${
							device.connected ? "bg-emerald-400" : "bg-white/25"
						}`}
					/>
					<span className="truncate text-[12px] font-semibold text-white/90">
						{device.name}
					</span>
				</div>
				{headerActions}
				<IconButton
					label="Close accessibility tree"
					tooltip="Close"
					size="panel"
					surface="toolbar"
					onClick={onClose}
				>
					<X size={14} strokeWidth={2} />
				</IconButton>
			</header>
			<div
				data-agentsims-accessibility-panel-body
				className={`min-h-0 flex-1 overflow-hidden ${bodyClassName}`}
			>
				{children}
			</div>
			{footer && (
				<footer className="shrink-0 border-t border-white/[0.08] px-3 py-2.5">
					{footer}
				</footer>
			)}
			{onResizePointerDown && (
				<AccessibilityResizeCornerHandle
					onPointerDown={onResizePointerDown}
					onKeyDown={onResizeKeyDown}
				/>
			)}
		</aside>
	);
}
