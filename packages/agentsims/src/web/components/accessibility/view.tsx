import {
	Eye,
	EyeOff,
	LoaderCircle,
	MousePointer2,
	RefreshCw,
	TriangleAlert,
} from "lucide-react";
import {
	useCallback,
	useEffect,
	useRef,
	useState,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { IconButton } from "../ui/icon-button";
import { resetAccessibilityTreeHorizontalOrigin } from "./tree";

const TREE_SPLIT_STORAGE_KEY = "agentsims:ax-tree-split";
const TREE_SPLIT_MIN = 0.34;
const TREE_SPLIT_MAX = 0.66;
const TREE_SPLIT_DEFAULT = 0.44;
const TREE_PANE_MIN_WIDTH = 220;
const DETAIL_PANE_MIN_WIDTH = 280;
const TWO_PANE_MIN_WIDTH = TREE_PANE_MIN_WIDTH + DETAIL_PANE_MIN_WIDTH;

export function clampAccessibilityTreeRatio(value: number): number {
	return Math.max(TREE_SPLIT_MIN, Math.min(TREE_SPLIT_MAX, value));
}

export function resolveAccessibilityPaneLayout(
	width: number,
	ratio: number,
	hasDetails: boolean,
): { detailsVisible: boolean; treeWidth: number; ratio: number } {
	if (!hasDetails || !Number.isFinite(width) || width < TWO_PANE_MIN_WIDTH) {
		return {
			detailsVisible: false,
			treeWidth: Math.max(0, width),
			ratio: clampAccessibilityTreeRatio(ratio),
		};
	}
	const minRatio = TREE_PANE_MIN_WIDTH / width;
	const maxRatio = (width - DETAIL_PANE_MIN_WIDTH) / width;
	const resolvedRatio = Math.max(
		minRatio,
		Math.min(maxRatio, clampAccessibilityTreeRatio(ratio)),
	);
	return {
		detailsVisible: true,
		treeWidth: Math.round(width * resolvedRatio),
		ratio: resolvedRatio,
	};
}

function readTreeRatio(): number {
	if (typeof window === "undefined") return TREE_SPLIT_DEFAULT;
	const value = Number(window.localStorage.getItem(TREE_SPLIT_STORAGE_KEY));
	return Number.isFinite(value)
		? clampAccessibilityTreeRatio(value)
		: TREE_SPLIT_DEFAULT;
}

function persistTreeRatio(value: number) {
	try {
		window.localStorage.setItem(
			TREE_SPLIT_STORAGE_KEY,
			String(clampAccessibilityTreeRatio(value)),
		);
	} catch (error) {
		console.warn("[agentsims:web] recoverable operation failed", error);
	}
}

export interface AccessibilityHeaderActionsProps {
	selecting: boolean;
	onSelectingChange: (selecting: boolean) => void;
	status?: string;
	elementCount?: number;
	sourceCount?: number;
	allNodesVisible?: boolean;
	onAllNodesVisibleChange?: (visible: boolean) => void;
	onRefresh?: () => void;
	refreshing?: boolean;
}

export type AccessibilityHeaderStatus =
	| { kind: "loading"; label: "Loading accessibility tree" }
	| { kind: "ready"; label: string }
	| { kind: "error"; label: "Accessibility unavailable"; tooltip: string };

export function resolveAccessibilityHeaderStatus({
	status,
	elementCount,
	sourceCount,
}: Pick<
	AccessibilityHeaderActionsProps,
	"status" | "elementCount" | "sourceCount"
>): AccessibilityHeaderStatus {
	const normalized = status?.toLowerCase() ?? "";
	const hasError = /(unavailable|failed|error|reconnecting)/.test(normalized);
	if (hasError) {
		return {
			kind: "error",
			label: "Accessibility unavailable",
			tooltip: "Accessibility data is unavailable. Try Refresh.",
		};
	}
	if (elementCount === undefined) {
		return { kind: "loading", label: "Loading accessibility tree" };
	}
	return {
		kind: "ready",
		label: `${elementCount}${sourceCount ? ` · ${sourceCount} RN` : ""}`,
	};
}

export function AccessibilityHeaderActions({
	selecting,
	onSelectingChange,
	status = "Accessibility ready",
	elementCount,
	sourceCount,
	allNodesVisible,
	onAllNodesVisibleChange,
	onRefresh,
	refreshing = false,
}: AccessibilityHeaderActionsProps) {
	const visibleStatus = resolveAccessibilityHeaderStatus({
		status,
		elementCount,
		sourceCount,
	});

	return (
		<div
			data-accessibility-header-actions
			className="flex min-w-0 items-center gap-1"
		>
			<IconButton
				label={
					selecting
						? "Stop selecting accessibility elements"
						: "Select accessibility element"
				}
				tooltip={selecting ? "Stop selecting" : "Select from phone"}
				selected={selecting}
				size="panel"
				surface="toolbar"
				onClick={() => onSelectingChange(!selecting)}
			>
				<MousePointer2 size={14} strokeWidth={2} />
			</IconButton>

			{onAllNodesVisibleChange && (
				<IconButton
					label={
						allNodesVisible
							? "Hide all accessibility outlines"
							: "Show all accessibility outlines"
					}
					tooltip={allNodesVisible ? "Hide outlines" : "Show outlines"}
					selected={allNodesVisible}
					size="panel"
					surface="toolbar"
					onClick={() => onAllNodesVisibleChange(!allNodesVisible)}
				>
					{allNodesVisible ? (
						<Eye size={14} strokeWidth={2} />
					) : (
						<EyeOff size={14} strokeWidth={2} />
					)}
				</IconButton>
			)}

			{visibleStatus.kind === "ready" ? (
				<span
					className="max-w-20 truncate px-1 text-right text-[10px] tabular-nums text-white/38"
					aria-live="polite"
				>
					{visibleStatus.label}
				</span>
			) : visibleStatus.kind === "loading" ? (
				<span
					role="status"
					aria-label={visibleStatus.label}
					title={visibleStatus.label}
					className="grid size-6 place-items-center text-white/34"
				>
					<LoaderCircle
						aria-hidden="true"
						size={13}
						className="animate-spin motion-reduce:animate-none"
					/>
				</span>
			) : (
				<span
					role="status"
					aria-label={visibleStatus.label}
					title={visibleStatus.tooltip}
					className="grid size-6 place-items-center text-amber-300/70"
				>
					<TriangleAlert aria-hidden="true" size={13} />
				</span>
			)}

			{onRefresh && (
				<IconButton
					label="Refresh accessibility tree"
					tooltip="Refresh"
					disabled={refreshing}
					size="panel"
					surface="toolbar"
					onClick={onRefresh}
				>
					<RefreshCw
						size={14}
						strokeWidth={2}
						className={
							refreshing ? "animate-spin motion-reduce:animate-none" : ""
						}
					/>
				</IconButton>
			)}
		</div>
	);
}

export interface AccessibilityViewProps {
	tree: ReactNode;
	details?: ReactNode;
}

export function AccessibilityView({ tree, details }: AccessibilityViewProps) {
	const hostRef = useRef<HTMLElement | null>(null);
	const ratioRef = useRef(readTreeRatio());
	const [treeRatio, setTreeRatio] = useState(ratioRef.current);
	const [hostWidth, setHostWidth] = useState(560);

	const paneLayout = resolveAccessibilityPaneLayout(
		hostWidth,
		treeRatio,
		Boolean(details),
	);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const update = () => {
			const width = host.getBoundingClientRect().width;
			setHostWidth(width);
			resetAccessibilityTreeHorizontalOrigin(host);
		};
		update();
		const observer =
			typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
		observer?.observe(host);
		return () => observer?.disconnect();
	}, []);

	const updateRatio = useCallback((clientX: number) => {
		const rect = hostRef.current?.getBoundingClientRect();
		if (!rect || rect.width <= 0) return;
		const requested = (clientX - rect.left) / rect.width;
		const next = resolveAccessibilityPaneLayout(
			rect.width,
			requested,
			true,
		).ratio;
		ratioRef.current = next;
		setTreeRatio(next);
		resetAccessibilityTreeHorizontalOrigin(hostRef.current);
	}, []);

	const onSplitPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			event.stopPropagation();
			const target = event.currentTarget;
			target.setPointerCapture(event.pointerId);
			const move = (moveEvent: PointerEvent) => updateRatio(moveEvent.clientX);
			const finish = (upEvent: PointerEvent) => {
				updateRatio(upEvent.clientX);
				persistTreeRatio(ratioRef.current);
				if (target.hasPointerCapture(event.pointerId)) {
					target.releasePointerCapture(event.pointerId);
				}
				target.removeEventListener("pointermove", move);
				target.removeEventListener("pointerup", finish);
				target.removeEventListener("pointercancel", finish);
			};
			target.addEventListener("pointermove", move);
			target.addEventListener("pointerup", finish);
			target.addEventListener("pointercancel", finish);
		},
		[updateRatio],
	);

	const onSplitKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
			event.preventDefault();
			const direction = event.key === "ArrowLeft" ? -1 : 1;
			const width = hostRef.current?.getBoundingClientRect().width ?? hostWidth;
			const next = resolveAccessibilityPaneLayout(
				width,
				ratioRef.current + direction * 0.03,
				true,
			).ratio;
			ratioRef.current = next;
			setTreeRatio(next);
			persistTreeRatio(next);
		},
		[hostWidth],
	);

	return (
		<section
			ref={hostRef}
			aria-label="Accessibility inspector"
			className="relative flex h-full min-h-0 min-w-0 flex-col overflow-x-hidden"
		>
			<div
				className="grid min-h-0 flex-1"
				style={{
					gridTemplateColumns: paneLayout.detailsVisible
						? `${paneLayout.treeWidth}px minmax(0, 1fr)`
						: "minmax(0, 1fr)",
				}}
			>
				<div
					className={`min-h-0 overflow-hidden ${
						paneLayout.detailsVisible ? "border-r border-white/[0.08]" : ""
					}`}
					data-accessibility-tree-host
				>
					{tree}
				</div>

				{paneLayout.detailsVisible && details && (
					<aside
						aria-label="Selected accessibility element"
						className="min-h-0 min-w-0 overflow-hidden bg-black/10"
					>
						{details}
					</aside>
				)}
			</div>

			{paneLayout.detailsVisible && (
				<div
					role="separator"
					aria-label="Resize accessibility tree and detail panes"
					aria-orientation="vertical"
					aria-valuemin={Math.round(TREE_SPLIT_MIN * 100)}
					aria-valuemax={Math.round(TREE_SPLIT_MAX * 100)}
					aria-valuenow={Math.round(treeRatio * 100)}
					tabIndex={0}
					data-accessibility-splitter
					onPointerDown={onSplitPointerDown}
					onKeyDown={onSplitKeyDown}
					className="group absolute bottom-0 top-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none outline-none"
					style={{ left: `${paneLayout.treeWidth}px` }}
				>
					<span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent [transition:background-color_110ms_ease] group-hover:bg-white/20 group-focus-visible:bg-blue-400/80 motion-reduce:transition-none" />
				</div>
			)}
		</section>
	);
}
