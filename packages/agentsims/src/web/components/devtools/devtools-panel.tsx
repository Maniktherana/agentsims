import { CodeXml, GripVertical, X } from "lucide-react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import {
	collapseScreencastPane,
	type DevToolsTarget,
} from "../../devtools/client";
import { useAccessibilityPanelPosition } from "../../accessibility/panel-position";
import { IconButton } from "../ui/icon-button";
import { FloatingPanelResizeHandle } from "../ui/floating-panel-resize-handle";
import { DevToolsTargetPicker } from "./devtools-target-picker";

export function DevToolsPanel({
	open,
	onClose,
	anchor,
	udid,
	deviceName,
	targets,
	selectedTargetId,
	onSelectTarget,
	loading,
	error,
}: {
	open: boolean;
	onClose: () => void;
	anchor: HTMLElement | null;
	udid: string;
	deviceName: string;
	targets: DevToolsTarget[];
	selectedTargetId: string | null;
	onSelectTarget: (id: string) => void;
	loading: boolean;
	error: string | null;
}) {
	const position = useAccessibilityPanelPosition(
		anchor,
		open,
		`devtools:${udid}`,
	);
	if (!open || typeof document === "undefined") return null;
	const selected = selectedTargetId
		? (targets.find((target) => target.id === selectedTargetId) ?? null)
		: null;
	const body: ReactNode = error ? (
		<div className="flex h-full items-center justify-center bg-panel-deep p-6 text-center text-[13px] text-white/[0.58]">
			{error}
		</div>
	) : selected ? (
		<iframe
			key={selected.id}
			src={selected.devtoolsFrontendUrl}
			title={`DevTools - ${selected.title || selected.url || selected.id}`}
			className="block size-full border-none bg-white"
			onLoad={(event) => {
				if (selected.provider === "webkit") {
					collapseScreencastPane(event.currentTarget);
				}
			}}
		/>
	) : (
		<div className="flex h-full items-center justify-center bg-panel-deep p-6 text-center text-[13px] text-white/[0.58]">
			{loading ? "Looking for browser targets..." : "Select a browser target."}
		</div>
	);
	return createPortal(
		<div
			ref={position.panelRef}
			style={position.style}
			data-agentsims-devtools-panel
		>
			<aside
				data-agentsims-floating-panel
				className="agentsims-accessibility-panel-enter relative flex size-full min-w-0 flex-col overflow-hidden rounded-[14px] border border-white/[0.1] bg-[var(--agentsims-panel-bg,#181818)] text-white shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
			>
				<header
					onPointerDown={position.onMovePointerDown}
					className="flex h-10 shrink-0 cursor-grab select-none items-center gap-1.5 px-2 active:cursor-grabbing"
				>
					<GripVertical
						aria-hidden="true"
						size={12}
						strokeWidth={1.8}
						className="-mr-1 shrink-0 text-white/25"
					/>
					<span className="grid size-7 shrink-0 place-items-center rounded-md border border-white/[0.08] bg-white/[0.04] text-white/58">
						<CodeXml size={14} strokeWidth={1.9} />
					</span>
					<div
						className="min-w-0 flex-1"
						onPointerDown={(event) => event.stopPropagation()}
					>
						{targets.length > 1 ? (
							<DevToolsTargetPicker
								targets={targets}
								selected={selected}
								onSelectTarget={onSelectTarget}
							/>
						) : (
							<span className="block truncate text-[12px] font-medium text-white/85">
								{selected?.title || selected?.url || "Browser DevTools"}
							</span>
						)}
					</div>
					<span
						className="max-w-32 truncate text-[11px] text-white/42"
						title={deviceName}
					>
						{deviceName}
					</span>
					<IconButton
						label="Close DevTools"
						tooltip="Close"
						size="panel"
						surface="toolbar"
						onClick={onClose}
					>
						<X size={14} strokeWidth={2} />
					</IconButton>
				</header>
				<div className="min-h-0 flex-1 overflow-hidden rounded-b-[13px] bg-white">
					{body}
				</div>
				<FloatingPanelResizeHandle
					onPointerDown={position.onResizePointerDown}
					onKeyDown={position.onResizeKeyDown}
					ariaLabel="Resize DevTools panel"
				/>
			</aside>
		</div>,
		document.body,
	);
}
