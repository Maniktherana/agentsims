import { motion, type MotionValue } from "motion/react";
import { PanelToolbar } from "@agentsims/ui/components/panel-toolbar";
import {
	useId,
	useLayoutEffect,
	useRef,
	type KeyboardEvent,
	type PointerEvent,
	type ReactNode,
} from "react";
import {
	clampIntegratedToolPanelHeight,
	integratedToolPanelHeightBounds,
	integratedToolPanelHeightForKey,
	integratedToolPanelPointerHeight,
	shouldCloseIntegratedToolPanelOnPointerRelease,
} from "../../workspace/integrated-tool-panel-height";
import { PanelCloseButton, PanelHeader, PanelTitle } from "../ui/panel";

export interface IntegratedToolPanelProps {
	open: boolean;
	title: string;
	height: number;
	onHeightChange: (height: number) => void;
	onClose: () => void;
	children: ReactNode;
	minHeight?: number;
	maxHeight?: number;
	headerActions?: ReactNode;
	id?: string;
	compactHeader?: boolean;
	motionOffset?: MotionValue<string>;
	motionVisibility?: MotionValue<"hidden" | "visible">;
}

/** The workspace owns canvas reservation, dock placement, and active tool readers. */
export function IntegratedToolPanel({
	open,
	title,
	height,
	onHeightChange,
	onClose,
	children,
	minHeight,
	maxHeight,
	headerActions,
	id,
	compactHeader = false,
	motionOffset,
	motionVisibility,
}: IntegratedToolPanelProps) {
	const generatedId = useId();
	const panelId = id ?? `integrated-tool-panel-${generatedId}`;
	const titleId = `${panelId}-title`;
	const panelRef = useRef<HTMLElement | null>(null);
	const resizeHandleRef = useRef<HTMLDivElement | null>(null);
	const openerRef = useRef<HTMLElement | null>(null);
	const wasOpen = useRef(false);
	const drag = useRef<{
		pointerId: number;
		startY: number;
		startHeight: number;
		preferredHeight: number;
	} | null>(null);
	const bounds = integratedToolPanelHeightBounds(minHeight, maxHeight);
	const boundedHeight = clampIntegratedToolPanelHeight(
		height,
		bounds.min,
		bounds.max,
	);
	const cancelResize = (pointerId?: number) => {
		const active = drag.current;
		if (!active || (pointerId !== undefined && active.pointerId !== pointerId))
			return;
		drag.current = null;
		if (resizeHandleRef.current?.hasPointerCapture(active.pointerId)) {
			resizeHandleRef.current.releasePointerCapture(active.pointerId);
		}
	};

	const restoreOpenerFocus = () => {
		const panel = panelRef.current;
		if (
			panel?.contains(panel.ownerDocument.activeElement) &&
			openerRef.current?.isConnected
		) {
			openerRef.current.focus({ preventScroll: true });
		}
	};
	const close = () => {
		cancelResize();
		restoreOpenerFocus();
		onClose();
	};

	useLayoutEffect(() => {
		const panel = panelRef.current;
		if (open && !wasOpen.current) {
			const focused = panel?.ownerDocument.activeElement;
			openerRef.current =
				focused instanceof HTMLElement && !panel?.contains(focused)
					? focused
					: null;
		}
		if (!open) {
			cancelResize();
			if (wasOpen.current) restoreOpenerFocus();
		}
		// Return focus before inert can move it to the document body on external close.
		if (panel) panel.inert = !open;
		wasOpen.current = open;
	}, [open]);
	useLayoutEffect(() => () => cancelResize(), []);

	const resizeStart = (event: PointerEvent<HTMLDivElement>) => {
		if (!open || drag.current || event.button !== 0 || !event.isPrimary) return;
		event.preventDefault();
		event.stopPropagation();
		event.currentTarget.focus({ preventScroll: true });
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = {
			pointerId: event.pointerId,
			startY: event.clientY,
			startHeight: boundedHeight,
			preferredHeight: Number.isFinite(height) ? height : boundedHeight,
		};
	};
	const resizeMove = (event: PointerEvent<HTMLDivElement>) => {
		const active = drag.current;
		if (!open || !active || active.pointerId !== event.pointerId) return;
		event.preventDefault();
		event.stopPropagation();
		const next = integratedToolPanelPointerHeight(
			active.startHeight,
			active.startY,
			event.clientY,
			bounds.min,
			bounds.max,
		);
		if (next !== boundedHeight) onHeightChange(next);
	};
	const resizeEnd = (event: PointerEvent<HTMLDivElement>) => {
		cancelResize(event.pointerId);
	};
	const resizeRelease = (event: PointerEvent<HTMLDivElement>) => {
		const active = drag.current;
		if (!open || !active || active.pointerId !== event.pointerId) return;
		const shouldClose = shouldCloseIntegratedToolPanelOnPointerRelease(
			active.startHeight,
			active.startY,
			event.clientY,
			event.currentTarget.ownerDocument.defaultView?.innerHeight ?? 0,
		);
		cancelResize(event.pointerId);
		if (!shouldClose) return;
		event.preventDefault();
		event.stopPropagation();
		onHeightChange(active.preferredHeight);
		close();
	};
	const resizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
		if (!open || event.altKey || event.ctrlKey || event.metaKey) return;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			close();
			return;
		}
		const next = integratedToolPanelHeightForKey(
			boundedHeight,
			event.key,
			event.shiftKey,
			bounds.min,
			bounds.max,
		);
		if (next === null) return;
		event.preventDefault();
		event.stopPropagation();
		if (next !== boundedHeight) onHeightChange(next);
	};

	return (
		<motion.section
			ref={panelRef}
			id={panelId}
			aria-labelledby={titleId}
			aria-hidden={!open}
			data-state={open ? "open" : "closed"}
			className="fixed inset-x-0 bottom-0 z-30 flex min-h-0 min-w-0 flex-col border-t border-white/10 bg-panel-bg text-white/90"
			style={{
				height: boundedHeight,
				transform: motionOffset,
				visibility: motionVisibility ?? (open ? "visible" : "hidden"),
				opacity: motionOffset || open ? 1 : 0,
				pointerEvents: open ? "auto" : "none",
			}}
		>
			<div
				ref={resizeHandleRef}
				role="separator"
				aria-label="Resize tool panel"
				aria-orientation="horizontal"
				aria-controls={panelId}
				aria-valuemin={bounds.min}
				aria-valuemax={bounds.max}
				aria-valuenow={boundedHeight}
				aria-valuetext={`${boundedHeight} pixels high`}
				tabIndex={open ? 0 : -1}
				onPointerDown={resizeStart}
				onPointerMove={resizeMove}
				onPointerUp={resizeRelease}
				onPointerCancel={resizeEnd}
				onLostPointerCapture={resizeEnd}
				onKeyDown={resizeKey}
				className="group absolute inset-x-0 -top-2 z-20 flex h-4 touch-none cursor-row-resize select-none items-center justify-center outline-none"
			>
				<span
					aria-hidden="true"
					className="h-0.5 w-8 rounded-full bg-white/25 group-focus-visible:bg-white/55 group-focus-visible:ring-2 group-focus-visible:ring-white/30 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-panel-bg"
				/>
			</div>
			{compactHeader ? (
				<>
					<h2 id={titleId} className="sr-only">
						{title}
					</h2>
					<PanelToolbar variant="overlay">
						{headerActions}
						<PanelCloseButton onClick={close} ariaLabel="Close tool panel" />
					</PanelToolbar>
				</>
			) : (
				<PanelHeader>
					<h2 id={titleId} className="min-w-0 truncate">
						<PanelTitle>{title}</PanelTitle>
					</h2>
					<div className="flex min-w-0 items-center gap-1.5">
						{headerActions}
						<PanelCloseButton onClick={close} ariaLabel="Close tool panel" />
					</div>
				</PanelHeader>
			)}
			<div className="scroll-fade-y scroll-fade-8 min-h-0 min-w-0 flex-1 overflow-auto [scrollbar-width:thin]">
				{children}
			</div>
		</motion.section>
	);
}
