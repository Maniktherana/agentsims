import { Button } from "@agentsims/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@agentsims/ui/components/tooltip";
import { getDeviceType } from "../../../simulator/index";
import { Eye, EyeOff, LoaderCircle, Power, RotateCcw } from "lucide-react";
import { type GridDevice, runtimeLabel } from "../../../workspace/grid";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import { TextStateSwap } from "@agentsims/ui/motion/text-state-swap";
import { DeviceGlyph } from "./device-glyph";

export type DeviceLifecyclePhase =
	| "available"
	| "booting"
	| "connecting"
	| "shutting-down"
	| "streaming";

export function deviceLifecycleStatus(
	phase: DeviceLifecyclePhase,
	runtime: string,
): string {
	if (phase === "shutting-down") return "Shutting down";
	if (phase === "streaming") return `Streaming · ${runtime}`;
	if (phase === "booting") return `Booting · ${runtime}`;
	if (phase === "connecting") return `Connecting · ${runtime}`;
	return `Available · ${runtime}`;
}

export function resolveDeviceLifecyclePhase(
	device: Pick<GridDevice, "helper" | "state">,
	starting: boolean,
	shuttingDown: boolean,
	transportConnected?: boolean,
): DeviceLifecyclePhase {
	const nativeState = device.state
		.trim()
		.toLowerCase()
		.replace(/[\s_-]+/g, "-");
	if (shuttingDown || nativeState === "shutting-down") return "shutting-down";
	if (nativeState === "booting" || nativeState === "creating") return "booting";
	if (transportConnected === true) return "streaming";
	if (transportConnected === false && device.helper) return "connecting";
	if (device.helper) return "streaming";
	if (starting && nativeState !== "booted") return "booting";
	if (starting || nativeState === "booted") return "connecting";
	return nativeState === "shutdown" ? "available" : "connecting";
}

function DeviceStatusGlyph({ phase }: { phase: DeviceLifecyclePhase }) {
	if (phase === "available") return null;
	return (
		<span
			aria-hidden="true"
			data-device-status-anchor
			data-device-status-glyph={phase}
			className={`pointer-events-none absolute -bottom-2 -right-2 grid size-4 place-items-center ${
				phase === "streaming"
					? "text-[#34d399]"
					: phase === "shutting-down"
						? "text-white/45"
						: "text-amber-300/80"
			}`}
		>
			<IconSwap state={phase}>
				{phase === "booting" ? (
					<RotateCcw
						size={14}
						strokeWidth={2}
						className="agentsims-device-status-spin"
					/>
				) : phase === "connecting" ? (
					<LoaderCircle
						size={14}
						strokeWidth={2}
						className="agentsims-device-status-spin"
					/>
				) : phase === "shutting-down" ? (
					<span className="agentsims-device-status-breathe size-2.5 rounded-full border border-current" />
				) : (
					<span className="size-1.5 rounded-full bg-current" />
				)}
			</IconSwap>
		</span>
	);
}

// A single horizontal device row in the sidebar (Xcode-style): family glyph,
// name + status, and the runtime version on the trailing edge. Clicking the row
// selects the device — the main view swaps to its stream, or to a placeholder
// when it isn't running yet.
export function DeviceRow({
	device,
	active,
	visible,
	showVisibilityControl = false,
	starting,
	shuttingDown,
	transportConnected,
	onSelect,
	onVisibleChange,
	onShutdown,
}: {
	device: GridDevice;
	active: boolean;
	visible?: boolean;
	showVisibilityControl?: boolean;
	starting: boolean;
	shuttingDown: boolean;
	transportConnected?: boolean;
	onSelect: () => void;
	onVisibleChange?: (visible: boolean) => void;
	onShutdown: () => void;
}) {
	const helper = device.helper;
	const isBooted = device.state === "Booted";
	const type = getDeviceType(device.name);
	const runtime = runtimeLabel(device.runtime);
	const phase = resolveDeviceLifecyclePhase(
		device,
		starting,
		shuttingDown,
		transportConnected,
	);
	const transitioning =
		phase === "booting" || phase === "connecting" || phase === "shutting-down";
	const accessibleStatus = deviceLifecycleStatus(phase, runtime);
	const status = phase === "available" ? runtime : accessibleStatus;
	const canShutdown = helper || isBooted;
	const iconBackingClass = "bg-white/6";
	const iconColorClass = "text-white/55";
	const rowStateClass = transitioning
		? "cursor-default text-white/70"
		: helper
			? "cursor-pointer text-white/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-white/25"
			: active
				? "cursor-pointer bg-white/10 text-white"
				: "cursor-pointer text-white/90 hover:bg-white/8";

	return (
		<div
			role="button"
			tabIndex={transitioning ? -1 : 0}
			aria-pressed={active}
			aria-disabled={transitioning || undefined}
			aria-busy={transitioning || undefined}
			aria-label={`${device.name}, ${accessibleStatus}`}
			data-device-phase={phase}
			onClick={transitioning ? undefined : onSelect}
			onKeyDown={(e) => {
				if (transitioning) return;
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect();
				}
			}}
			className={`group relative flex items-center gap-2.5 px-2 py-1.5 rounded-md select-none [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] motion-reduce:transition-none ${rowStateClass}`}
		>
			<div
				className="relative size-9 shrink-0 overflow-visible"
				data-device-icon-shell
			>
				<div
					className={`grid size-full place-items-center overflow-hidden rounded-md ${iconBackingClass} ${iconColorClass}`}
					data-device-icon-tile
				>
					<DeviceGlyph type={type} screenOn={phase === "streaming"} />
				</div>
				<DeviceStatusGlyph phase={phase} />
			</div>

			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold leading-tight">
					{device.name}
				</div>
				{status && (
					<div
						className={`truncate text-[11px] leading-tight ${
							phase === "streaming"
								? "text-[#34d399]"
								: transitioning
									? "text-white/45"
									: active
										? "text-white/75"
										: "text-white/45"
						}`}
					>
						<TextStateSwap>{status}</TextStateSwap>
					</div>
				)}
			</div>

			<div
				data-testid="device-row-trailing-slot"
				className={
					showVisibilityControl
						? "shrink-0 flex items-center gap-0.5"
						: "relative flex h-6 w-[72px] shrink-0 items-center justify-end"
				}
			>
				{showVisibilityControl ? (
					<>
						<Tooltip>
							<TooltipTrigger
								render={
									<Button
										aria-label={`${visible ? "Hide" : "Show"} ${device.name}`}
										aria-pressed={!!visible}
										variant="toolbar"
										size="icon-xs"
										className={`!border-transparent !bg-transparent hover:!bg-white/[0.06] ${visible ? "!text-white" : "!text-white/55 hover:!text-white"}`}
										disabled={transitioning}
										onClick={(event) => {
											event.preventDefault();
											event.stopPropagation();
											onVisibleChange?.(!visible);
										}}
									/>
								}
							>
								<IconSwap state={visible ? "visible" : "hidden"}>
									{visible ? (
										<Eye size={14} strokeWidth={2} />
									) : (
										<EyeOff size={14} strokeWidth={2} />
									)}
								</IconSwap>
							</TooltipTrigger>
							<TooltipContent>
								{visible ? "Hide from canvas" : "Show on canvas"}
							</TooltipContent>
						</Tooltip>
						{canShutdown && (
							<Tooltip>
								<TooltipTrigger
									render={
										<Button
											aria-label="Shut down device"
											variant="danger-ghost"
											size="icon-xs"
											className="!border-transparent !bg-transparent !text-red-400 hover:!bg-red-500/10"
											disabled={transitioning}
											onClick={(event) => {
												event.preventDefault();
												event.stopPropagation();
												onShutdown();
											}}
										/>
									}
								>
									<Power size={14} strokeWidth={2} />
								</TooltipTrigger>
								<TooltipContent>
									{shuttingDown ? "Shutting down" : "Shut down"}
								</TooltipContent>
							</Tooltip>
						)}
					</>
				) : (
					<>
						<span
							className={`absolute right-0 whitespace-nowrap text-[11px] font-mono tabular-nums [transition:opacity_0.12s] ${
								active ? "text-white/85" : "text-white/40"
							} ${canShutdown ? "group-hover:opacity-0 group-focus-within:opacity-0" : ""}`}
						>
							{runtime}
						</span>

						{canShutdown && (
							<Button
								variant="unstyled"
								size="unstyled"
								type="button"
								title={shuttingDown ? "Shutting down" : "Shut down device"}
								aria-label="Shut down device"
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									onShutdown();
								}}
								disabled={transitioning}
								className={`absolute right-0 top-1/2 -translate-y-1/2 grid place-items-center size-5 rounded-md opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [transition:opacity_0.12s,background_0.12s,color_0.12s] ${
									active
										? "text-white/80 hover:bg-white/20"
										: "text-white/70 hover:bg-white/12 hover:text-white"
								}`}
							>
								<Power size={13} strokeWidth={2.2} />
							</Button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
