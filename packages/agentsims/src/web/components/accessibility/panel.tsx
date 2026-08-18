import {
	Accessibility as AccessibilityIcon,
	GripVertical,
	X,
} from "lucide-react";
import {
	useId,
	type KeyboardEventHandler,
	type PointerEventHandler,
	type ReactNode,
} from "react";
import { IconButton } from "../ui/icon-button";
import {
	FloatingPanelResizeHandle,
	floatingPanelResizeVisualPhase,
} from "../ui/floating-panel-resize-handle";
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
			data-agentsims-floating-panel
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
				<FloatingPanelResizeHandle
					onPointerDown={onResizePointerDown}
					onKeyDown={onResizeKeyDown}
					ariaLabel="Resize accessibility panel"
				/>
			)}
		</aside>
	);
}

export const accessibilityResizeVisualPhase = floatingPanelResizeVisualPhase;
