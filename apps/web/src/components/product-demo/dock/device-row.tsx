import { Eye, EyeOff, Power } from "lucide-react";
import { TextStateSwap } from "@agentsims/ui/motion/text-state-swap";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";
import { DeviceGlyph, DeviceStatusGlyph } from "./glyphs";
import { Button } from "@agentsims/ui/components/button";
import { deviceStatus, type DemoDevice } from "./devices";

export function DeviceRow({
	device,
	active,
}: {
	device: DemoDevice;
	active: boolean;
}) {
	const { phase, visible } = device;
	const transitioning =
		phase === "booting" || phase === "connecting" || phase === "shutting-down";
	const running = phase !== "available";
	const canShutdown = visible;
	const accessibleStatus = deviceStatus(device);
	const status = running ? accessibleStatus : device.runtime;
	const rowStateClass = transitioning
		? "cursor-default text-white/70"
		: visible
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
			className={`group relative flex items-center gap-2.5 px-2 py-1.5 rounded-md select-none [transition:background_var(--agentsims-duration-hover)_var(--agentsims-ease-standard)] motion-reduce:transition-none ${rowStateClass}`}
		>
			<div
				className="relative size-9 shrink-0 overflow-visible"
				data-device-icon-shell
			>
				<div
					className="grid size-full place-items-center overflow-hidden rounded-md bg-white/6 text-white/55"
					data-device-icon-tile
				>
					<DeviceGlyph type={device.type} screenOn={phase === "streaming"} />
				</div>
				<DeviceStatusGlyph phase={phase} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="truncate text-[13px] font-semibold leading-tight">
					{device.name}
				</div>
				<div
					className={`truncate text-[11px] leading-tight ${phase === "streaming" ? "text-[#34d399]" : transitioning ? "text-white/45" : active ? "text-white/75" : "text-white/45"}`}
				>
					<TextStateSwap>{status}</TextStateSwap>
				</div>
			</div>
			<div
				data-testid="device-row-trailing-slot"
				className={
					running
						? "shrink-0 flex items-center gap-0.5"
						: "relative shrink-0 w-8 h-6 flex items-center justify-end"
				}
			>
				{running ? (
					<>
						<Button
							aria-label={`${visible ? "Hide" : "Show"} ${device.name}`}
							aria-pressed={visible}
							disabled={transitioning}
							variant="toolbar"
							size="icon-xs"
							className={`!border-transparent !bg-transparent hover:!bg-white/[0.06] ${visible ? "!text-white" : "!text-white/55 hover:!text-white"}`}
						>
							<IconSwap state={visible ? "visible" : "hidden"}>
								{visible ? (
									<Eye size={14} strokeWidth={2} />
								) : (
									<EyeOff size={14} strokeWidth={2} />
								)}
							</IconSwap>
						</Button>
						{canShutdown && (
							<Button
								aria-label="Shut down device"
								disabled={transitioning}
								variant="danger-ghost"
								size="icon-xs"
								className="!border-transparent !bg-transparent !text-red-400 hover:!bg-red-500/10"
							>
								<Power size={14} strokeWidth={2} />
							</Button>
						)}
					</>
				) : (
					<span
						className={`absolute right-0 text-[11px] font-mono tabular-nums [transition:opacity_0.12s] ${active ? "text-white/85" : "text-white/40"}`}
					>
						{device.version}
					</span>
				)}
			</div>
		</div>
	);
}
