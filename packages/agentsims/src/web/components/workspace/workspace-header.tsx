import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type ButtonHTMLAttributes,
	type ReactNode,
	type RefObject,
} from "react";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	type Transition,
	type Variants,
} from "motion/react";
import {
	MonitorSmartphone,
	RotateCcw,
	Search,
	Settings,
	X,
} from "lucide-react";
import { type GridDevice, runtimeLabel } from "../../workspace/grid";
import { IconButton } from "../ui/icon-button";
import {
	deviceLifecycleStatus,
	DeviceRow,
	resolveDeviceLifecyclePhase,
	type DeviceLifecyclePhase,
} from "../dock/devices/device-row";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";

const DEVICE_SKELETON_ROWS = 8;

export function partitionDevicePickerDevices(
	devices: readonly GridDevice[],
	starting: Readonly<Record<string, boolean>>,
	shuttingDown: Readonly<Record<string, boolean>>,
): { runningDevices: GridDevice[]; availableDevices: GridDevice[] } {
	const runningDevices: GridDevice[] = [];
	const availableDevices: GridDevice[] = [];
	for (const device of devices) {
		const phase = resolveDeviceLifecyclePhase(
			device,
			!!starting[device.device],
			!!shuttingDown[device.device],
		);
		(phase === "available" ? availableDevices : runningDevices).push(device);
	}
	return { runningDevices, availableDevices };
}

export function reconcileDevicePhaseAnnouncements(
	previous: ReadonlyMap<string, DeviceLifecyclePhase> | null,
	devices: readonly GridDevice[],
	starting: Readonly<Record<string, boolean>>,
	shuttingDown: Readonly<Record<string, boolean>>,
): { phases: Map<string, DeviceLifecyclePhase>; announcement: string } {
	const phases = new Map<string, DeviceLifecyclePhase>();
	const changes: string[] = [];
	for (const device of devices) {
		const phase = resolveDeviceLifecyclePhase(
			device,
			!!starting[device.device],
			!!shuttingDown[device.device],
		);
		phases.set(device.device, phase);
		if (previous?.has(device.device) && previous.get(device.device) !== phase) {
			changes.push(
				`${device.name}: ${deviceLifecycleStatus(phase, runtimeLabel(device.runtime))}`,
			);
		}
	}
	return { phases, announcement: changes.join(". ") };
}
const ISLAND_PANEL_VARIANTS = {
	enter: (direction: number) => ({
		opacity: 0,
		x: direction * 16,
		filter: "blur(4px)",
	}),
	center: { opacity: 1, x: 0, filter: "blur(0px)" },
	exit: (direction: number) => ({
		opacity: 0,
		x: direction * -16,
		filter: "blur(4px)",
	}),
} satisfies Variants;
const ISLAND_PANEL_TRANSITION = {
	duration: 0.24,
	ease: [0, 0, 0.2, 1],
} satisfies Transition;

export function WorkspaceHeader({
	pickerOpen,
	onPickerOpenChange,
	devices,
	total,
	hasMore,
	onLoadMore,
	onLoadAll,
	onResetPage,
	selectedUdid,
	visibleUdids,
	streamingByDevice,
	onSelect,
	settingsUdid,
	onSettingsSelect,
	onToggleVisible,
	onStart,
	starting,
	shuttingDown,
	onShutdown,
	toolsOpen,
	onToggleTools,
	hasActiveDevice,
	onResetLayout,
}: {
	pickerOpen: boolean;
	onPickerOpenChange: (open: boolean) => void;
	devices: GridDevice[] | null;
	total: number;
	hasMore: boolean;
	onLoadMore: () => void;
	onLoadAll: () => void;
	onResetPage: () => void;
	selectedUdid: string | null;
	visibleUdids: Set<string>;
	streamingByDevice: Readonly<Record<string, boolean>>;
	onSelect: (udid: string) => void;
	settingsUdid: string | null;
	onSettingsSelect: (udid: string) => void;
	onToggleVisible: (udid: string, visible: boolean) => void;
	onStart: (udid: string) => void;
	starting: Record<string, boolean>;
	shuttingDown: Record<string, boolean>;
	onShutdown: (udid: string) => void;
	toolsOpen: boolean;
	onToggleTools: () => void;
	hasActiveDevice: boolean;
	onResetLayout: () => void;
}) {
	const [query, setQuery] = useState("");
	const [commandHeld, setCommandHeld] = useState(false);
	const commandHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const pickerRef = useRef<HTMLDivElement | null>(null);
	const searchRef = useRef<HTMLInputElement | null>(null);
	const wasSearchingRef = useRef(false);
	const [dockWidthAnimating, setDockWidthAnimating] = useState(false);
	const previousDockWidthRef = useRef<number | null>(null);
	const filtered = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized || !devices) return devices;
		return devices.filter(
			(device) =>
				device.name.toLowerCase().includes(normalized) ||
				runtimeLabel(device.runtime).toLowerCase().includes(normalized),
		);
	}, [devices, query]);
	const partitionedDevices = useMemo(
		() =>
			filtered
				? partitionDevicePickerDevices(filtered, starting, shuttingDown)
				: null,
		[filtered, shuttingDown, starting],
	);
	const runningDevices = partitionedDevices?.runningDevices ?? null;
	const availableDevices = partitionedDevices?.availableDevices ?? null;
	const visibleCount =
		devices?.filter(
			(device) => !!device.helper && visibleUdids.has(device.device),
		).length ?? 0;
	const devicesLabel = `Devices, ${visibleCount} shown`;
	const expanded = pickerOpen || toolsOpen;
	const activePanel = pickerOpen ? "devices" : toolsOpen ? "settings" : null;
	const previousPanelRef = useRef<"devices" | "settings" | null>(null);
	const panelDirectionRef = useRef(1);
	if (activePanel && activePanel !== previousPanelRef.current) {
		if (previousPanelRef.current) {
			panelDirectionRef.current = activePanel === "settings" ? 1 : -1;
		} else {
			panelDirectionRef.current = activePanel === "settings" ? 1 : -1;
		}
		previousPanelRef.current = activePanel;
	}
	const settingsDevices = useMemo(
		() =>
			devices?.filter(
				(device) => !!device.helper && visibleUdids.has(device.device),
			) ?? [],
		[devices, visibleUdids],
	);
	const settingsDeviceId = settingsDevices.some(
		(device) => device.device === settingsUdid,
	)
		? settingsUdid
		: (settingsDevices[0]?.device ?? null);
	const compactDockWidth = 96;
	const dockWidth = pickerOpen ? 400 : toolsOpen ? 400 : compactDockWidth;
	const dockHeight = expanded
		? Math.max(
				320,
				Math.min(
					620,
					(typeof window === "undefined" ? 800 : window.innerHeight) - 24,
				),
			)
		: 50;

	useLayoutEffect(() => {
		const previousWidth = previousDockWidthRef.current;
		previousDockWidthRef.current = dockWidth;
		if (previousWidth !== null && previousWidth !== dockWidth) {
			setDockWidthAnimating(true);
		}
	}, [dockWidth]);

	useEffect(() => {
		if (!pickerOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!pickerRef.current?.contains(event.target as Node))
				onPickerOpenChange(false);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onPickerOpenChange(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onPickerOpenChange, pickerOpen]);

	useEffect(() => {
		const searching = !!query.trim();
		if (searching && hasMore) onLoadAll();
		else if (!searching && wasSearchingRef.current) onResetPage();
		wasSearchingRef.current = searching;
	}, [hasMore, onLoadAll, onResetPage, query]);

	useEffect(() => {
		const hideCommandHints = () => {
			if (commandHintTimerRef.current) {
				clearTimeout(commandHintTimerRef.current);
				commandHintTimerRef.current = null;
			}
			setCommandHeld(false);
		};
		const scheduleCommandHints = () => {
			if (commandHintTimerRef.current) return;
			commandHintTimerRef.current = setTimeout(() => {
				commandHintTimerRef.current = null;
				setCommandHeld(true);
			}, 3_000);
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (
				event.key === "Meta" ||
				event.key === "Control" ||
				event.metaKey ||
				event.ctrlKey
			) {
				scheduleCommandHints();
			}
			if (!(event.metaKey || event.ctrlKey) || event.repeat) return;
			const key = event.key.toLowerCase();
			if (event.shiftKey && key === "d") {
				event.preventDefault();
				if (pickerOpen) onPickerOpenChange(false);
				else openPicker();
			} else if (key === "," && hasActiveDevice) {
				event.preventDefault();
				onToggleTools();
			} else if (key === "0") {
				event.preventDefault();
				onResetLayout();
			}
		};
		const onKeyUp = (event: KeyboardEvent) => {
			if (
				event.key === "Meta" ||
				event.key === "Control" ||
				(!event.metaKey && !event.ctrlKey)
			) {
				hideCommandHints();
			}
		};
		const onVisibilityChange = () => {
			if (document.visibilityState !== "visible") hideCommandHints();
		};
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		window.addEventListener("blur", hideCommandHints);
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
			window.removeEventListener("blur", hideCommandHints);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			if (commandHintTimerRef.current) {
				clearTimeout(commandHintTimerRef.current);
				commandHintTimerRef.current = null;
			}
		};
	}, [
		hasActiveDevice,
		onPickerOpenChange,
		onToggleTools,
		onResetLayout,
		pickerOpen,
	]);

	const openPicker = () => {
		onPickerOpenChange(true);
		requestAnimationFrame(() => searchRef.current?.focus());
	};

	return (
		<MotionConfig
			reducedMotion="user"
			transition={{ type: "spring", bounce: 0.03, visualDuration: 0.18 }}
		>
			<footer className="pointer-events-none fixed inset-x-3 bottom-3 z-50 flex justify-center font-system">
				<motion.div
					id="agentsims-workspace-dock"
					ref={pickerRef}
					role="toolbar"
					aria-label="Workspace"
					data-expanded={expanded ? "true" : "false"}
					initial={false}
					animate={{
						width: dockWidth,
						height: dockHeight,
						borderRadius: expanded ? 16 : 10,
					}}
					onAnimationComplete={() => setDockWidthAnimating(false)}
					className="pointer-events-auto relative flex max-w-[calc(100vw-24px)] flex-col overflow-visible border border-white/[0.1] bg-[#181818] shadow-[0_18px_56px_rgba(0,0,0,0.5)]"
				>
					<motion.div
						aria-hidden={!expanded}
						initial={false}
						animate={{
							opacity: expanded ? 1 : 0,
							y: expanded ? 0 : 8,
							filter: expanded ? "blur(0px)" : "blur(3px)",
						}}
						transition={{
							duration: expanded ? 0.1 : 0.07,
							delay: expanded ? 0.015 : 0,
						}}
						className={`relative min-h-0 flex-1 overflow-hidden rounded-t-[15px] ${
							expanded ? "" : "pointer-events-none"
						}`}
					>
						<AnimatePresence
							initial={false}
							mode="popLayout"
							custom={panelDirectionRef.current}
						>
							{pickerOpen ? (
								<motion.div
									key="devices"
									custom={panelDirectionRef.current}
									variants={ISLAND_PANEL_VARIANTS}
									initial="enter"
									animate="center"
									exit="exit"
									transition={ISLAND_PANEL_TRANSITION}
									role="dialog"
									aria-label="Devices"
									className="absolute inset-0 flex min-h-0 flex-col text-white/90"
								>
									<div className="flex h-11 shrink-0 items-center justify-between border-b border-white/[0.07] px-3">
										<span className="text-[12px] font-medium text-white/75">
											Devices
										</span>
										<div className="flex items-center gap-1.5">
											<span className="text-[10px] tabular-nums text-white/35">
												{visibleCount} shown
											</span>
											<PanelIconButton
												label="Reset canvas positions"
												onClick={onResetLayout}
											>
												<RotateCcw size={14} strokeWidth={2} />
											</PanelIconButton>
										</div>
									</div>
									<DevicePickerContent
										filtered={filtered}
										runningDevices={runningDevices}
										availableDevices={availableDevices}
										query={query}
										setQuery={setQuery}
										searchRef={searchRef}
										devices={devices}
										total={total}
										hasMore={hasMore}
										onLoadMore={onLoadMore}
										selectedUdid={selectedUdid}
										visibleUdids={visibleUdids}
										streamingByDevice={streamingByDevice}
										starting={starting}
										shuttingDown={shuttingDown}
										onSelect={onSelect}
										onToggleVisible={onToggleVisible}
										onStart={onStart}
										onShutdown={onShutdown}
									/>
								</motion.div>
							) : toolsOpen ? (
								<motion.div
									key="settings"
									custom={panelDirectionRef.current}
									variants={ISLAND_PANEL_VARIANTS}
									initial="enter"
									animate="center"
									exit="exit"
									transition={ISLAND_PANEL_TRANSITION}
									className="absolute inset-0 flex min-h-0 flex-col"
								>
									<div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#181818] px-2">
										<span className="ml-1 shrink-0 text-[11px] font-medium text-white/62">
											Settings
										</span>
										<Tabs
											value={settingsDeviceId ?? undefined}
											onValueChange={onSettingsSelect}
											className="min-w-0 flex-1 gap-0 overflow-hidden"
										>
											<TabsList
												variant="ghost"
												aria-label="Settings device"
												className="mx-auto max-w-full overflow-x-auto [scrollbar-width:none]"
											>
												{settingsDevices.map((device) => {
													return (
														<TabsTrigger
															key={device.device}
															value={device.device}
															className="max-w-32 truncate"
															title={device.name}
														>
															{device.name}
														</TabsTrigger>
													);
												})}
											</TabsList>
										</Tabs>
										<PanelIconButton
											label="Reset canvas positions"
											onClick={onResetLayout}
										>
											<RotateCcw size={14} strokeWidth={2} />
										</PanelIconButton>
										<button
											type="button"
											onClick={onToggleTools}
											className="grid size-8 shrink-0 place-items-center rounded-md text-white/42 outline-none [transition-property:background-color,color,transform] duration-[110ms] hover:bg-white/[0.07] hover:text-white/78 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white/35 motion-reduce:transition-none"
											aria-label="Close Settings"
										>
											<X size={15} strokeWidth={2} />
										</button>
									</div>
									<div
										id="agentsims-tools-dock-slot"
										className="relative min-h-0 flex-1 overflow-hidden"
									/>
								</motion.div>
							) : null}
						</AnimatePresence>
					</motion.div>

					<div
						className={`flex h-12 w-full min-w-0 shrink-0 items-center justify-center gap-1 p-1 ${
							dockWidthAnimating
								? "overflow-x-clip overflow-y-visible"
								: "overflow-visible"
						}`}
					>
						<WorkspaceDockButton
							onClick={() =>
								pickerOpen ? onPickerOpenChange(false) : openPicker()
							}
							label={devicesLabel}
							pressed={pickerOpen}
							badge={visibleCount}
							shortcut="⇧D"
							shortcutVisible={commandHeld}
							aria-expanded={pickerOpen}
							aria-haspopup="dialog"
						>
							<MonitorSmartphone
								size={17}
								strokeWidth={1.9}
								className="shrink-0"
							/>
						</WorkspaceDockButton>
						<WorkspaceDockButton
							onClick={onToggleTools}
							label="Device settings"
							pressed={toolsOpen}
							disabled={!hasActiveDevice}
							shortcut=","
							shortcutVisible={commandHeld}
						>
							<Settings size={17} strokeWidth={1.9} />
						</WorkspaceDockButton>
					</div>
				</motion.div>
			</footer>
		</MotionConfig>
	);
}

function PanelIconButton({
	label,
	children,
	onClick,
}: {
	label: string;
	children: ReactNode;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			title={`${label} (Cmd+0)`}
			onClick={onClick}
			className="grid size-8 shrink-0 place-items-center rounded-md text-white/42 outline-none [transition-property:background-color,color,transform] duration-[110ms] hover:bg-white/[0.07] hover:text-white/78 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-white/35 motion-reduce:transition-none"
		>
			{children}
		</button>
	);
}

function WorkspaceDockButton({
	label,
	pressed = false,
	badge,
	shortcut,
	shortcutVisible = false,
	children,
	disabled,
	...buttonProps
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
	label: string;
	pressed?: boolean;
	badge?: number | null;
	shortcut?: string;
	shortcutVisible?: boolean;
	children: ReactNode;
}) {
	return (
		<IconButton
			{...buttonProps}
			disabled={disabled}
			label={label}
			tooltip={label}
			selected={pressed}
			badge={badge}
			surface="dock"
			size="dock"
		>
			{children}
			{shortcut && (
				<ShortcutHint visible={shortcutVisible}>{shortcut}</ShortcutHint>
			)}
		</IconButton>
	);
}

function ShortcutHint({
	visible,
	anchor = "right",
	children,
}: {
	visible: boolean;
	anchor?: "right" | "first-slot";
	children: string;
}) {
	return (
		<kbd
			aria-hidden="true"
			className={`pointer-events-none absolute top-1/2 z-20 grid min-w-4 -translate-y-1/2 place-items-center border border-black/15 bg-[#f2f2f2] px-1 py-0.5 font-system text-[8px] font-semibold leading-none text-[#111] shadow-[0_2px_8px_rgba(0,0,0,0.42)] [border-radius:5px] [transition:opacity_80ms_ease,transform_100ms_cubic-bezier(0.16,1,0.3,1)] ${
				anchor === "first-slot" ? "left-[35px]" : "right-[-5px]"
			} ${visible ? "translate-x-0 opacity-100" : "translate-x-0 opacity-0"}`}
		>
			{children}
		</kbd>
	);
}

function DevicePickerContent({
	filtered,
	runningDevices,
	availableDevices,
	query,
	setQuery,
	searchRef,
	devices,
	total,
	hasMore,
	onLoadMore,
	selectedUdid,
	visibleUdids,
	streamingByDevice,
	starting,
	shuttingDown,
	onSelect,
	onToggleVisible,
	onStart,
	onShutdown,
}: {
	filtered: GridDevice[] | null;
	runningDevices: GridDevice[] | null;
	availableDevices: GridDevice[] | null;
	query: string;
	setQuery: (query: string) => void;
	searchRef: RefObject<HTMLInputElement | null>;
	devices: GridDevice[] | null;
	total: number;
	hasMore: boolean;
	onLoadMore: () => void;
	selectedUdid: string | null;
	visibleUdids: Set<string>;
	streamingByDevice: Readonly<Record<string, boolean>>;
	starting: Record<string, boolean>;
	shuttingDown: Record<string, boolean>;
	onSelect: (udid: string) => void;
	onToggleVisible: (udid: string, visible: boolean) => void;
	onStart: (udid: string) => void;
	onShutdown: (udid: string) => void;
}) {
	const phaseSnapshotRef = useRef<Map<string, DeviceLifecyclePhase> | null>(
		null,
	);
	const [phaseAnnouncement, setPhaseAnnouncement] = useState("");

	useEffect(() => {
		if (!devices) return;
		const result = reconcileDevicePhaseAnnouncements(
			phaseSnapshotRef.current,
			devices,
			starting,
			shuttingDown,
		);
		phaseSnapshotRef.current = result.phases;
		if (result.announcement) setPhaseAnnouncement(result.announcement);
	}, [devices, shuttingDown, starting]);

	return (
		<>
			<div className="sr-only" aria-atomic="true" aria-live="polite">
				{phaseAnnouncement}
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto px-2 pt-2 [scrollbar-width:thin]"
				onScroll={(event) => {
					if (query.trim() || !hasMore) return;
					const target = event.currentTarget;
					if (
						target.scrollTop + target.clientHeight >=
						target.scrollHeight - 200
					)
						onLoadMore();
				}}
			>
				{filtered === null ||
				runningDevices === null ||
				availableDevices === null ? (
					<DeviceListSkeleton />
				) : (
					<>
						<DeviceSectionTitle count={availableDevices.length}>
							Available
						</DeviceSectionTitle>
						{availableDevices.length === 0 ? (
							<EmptyDevices>
								{query
									? "No available devices match."
									: "No available devices found."}
							</EmptyDevices>
						) : (
							<div className="flex flex-col gap-0.5">
								{availableDevices.map((device) => (
									<DeviceRow
										key={device.device}
										device={device}
										active={device.device === selectedUdid}
										starting={!!starting[device.device]}
										shuttingDown={!!shuttingDown[device.device]}
										onSelect={() => {
											onSelect(device.device);
											onStart(device.device);
										}}
										onShutdown={() => onShutdown(device.device)}
									/>
								))}
							</div>
						)}
						{!query && hasMore && (
							<div className="px-2 py-2 text-center text-[10px] tabular-nums text-white/30">
								{devices?.length ?? 0} of {total}
							</div>
						)}
					</>
				)}
			</div>
			{runningDevices !== null && (
				<div className="max-h-44 shrink-0 overflow-x-hidden overflow-y-auto border-t border-white/[0.08] px-2 py-1 [scrollbar-width:thin]">
					<DeviceSectionTitle count={runningDevices.length}>
						Running
					</DeviceSectionTitle>
					{runningDevices.length === 0 ? (
						<EmptyDevices>
							{query ? "No running devices match." : "No devices are running."}
						</EmptyDevices>
					) : (
						<div className="flex flex-col gap-0.5">
							{runningDevices.map((device) => (
								<DeviceRow
									key={device.device}
									device={device}
									active={device.device === selectedUdid}
									visible={visibleUdids.has(device.device)}
									showVisibilityControl
									transportConnected={
										device.device === selectedUdid &&
										visibleUdids.has(device.device)
											? !!streamingByDevice[device.device]
											: undefined
									}
									starting={!!starting[device.device]}
									shuttingDown={!!shuttingDown[device.device]}
									onSelect={() => onSelect(device.device)}
									onVisibleChange={(visible) =>
										onToggleVisible(device.device, visible)
									}
									onShutdown={() => onShutdown(device.device)}
								/>
							))}
						</div>
					)}
				</div>
			)}
			<div className="flex shrink-0 items-center gap-2 border-t border-white/[0.08] bg-[#181818] p-2">
				<label className="flex h-10 min-w-0 flex-1 items-center gap-2 bg-white/[0.06] px-2.5 [border-radius:8px] [transition:background-color_150ms_ease] focus-within:bg-white/[0.09]">
					<Search
						size={14}
						strokeWidth={2}
						className="shrink-0 text-white/35"
					/>
					<input
						ref={searchRef}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search devices"
						className="min-w-0 flex-1 border-none bg-transparent text-[12px] text-white/90 outline-none placeholder:text-white/35"
					/>
					{query && (
						<button
							type="button"
							onClick={() => setQuery("")}
							className="grid size-8 place-items-center text-white/35 [border-radius:6px] [transition-property:background-color,color,scale] duration-150 hover:bg-white/[0.08] hover:text-white/75 active:scale-[0.96] motion-reduce:transition-none"
							aria-label="Clear search"
							title="Clear"
						>
							<X size={12} strokeWidth={2.2} />
						</button>
					)}
				</label>
			</div>
		</>
	);
}

function DeviceSectionTitle({
	children,
	count,
}: {
	children: string;
	count: number;
}) {
	return (
		<div className="flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase text-white/35">
			<span>{children}</span>
			<span className="tabular-nums text-white/25">{count}</span>
		</div>
	);
}

function EmptyDevices({ children }: { children: string }) {
	return (
		<div className="px-2 py-4 text-center text-[11px] text-white/35">
			{children}
		</div>
	);
}

function DeviceListSkeleton() {
	return (
		<div
			data-testid="device-list-skeleton"
			className="py-1"
			aria-label="Loading devices"
			aria-busy="true"
		>
			{Array.from({ length: DEVICE_SKELETON_ROWS }, (_, index) => (
				<div
					key={index}
					data-testid="device-row-skeleton"
					className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
					aria-hidden
				>
					<span className="size-9 shrink-0 rounded-md bg-white/[0.07]" />
					<span className="flex min-w-0 flex-1 flex-col gap-1.5">
						<span className="h-3 w-2/3 rounded-full bg-white/[0.1]" />
						<span className="h-2.5 w-2/5 rounded-full bg-white/[0.06]" />
					</span>
				</div>
			))}
		</div>
	);
}
