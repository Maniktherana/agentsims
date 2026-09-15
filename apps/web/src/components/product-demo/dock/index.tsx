import { AnimatePresence, motion } from "motion/react";
import { MonitorSmartphone, RotateCcw, Settings } from "lucide-react";
import { NumberMorph } from "../../ui/number-morph";
import { DeviceList } from "./device-list";
import { DockIconButton } from "./icon-button";
import type { DemoDevices } from "./devices";
import {
	WorkspaceDockSurface,
	ISLAND_PANEL_TRANSITION,
	ISLAND_PANEL_VARIANTS,
} from "./surface";

export function DemoDock({
	expanded,
	scale,
	devices,
}: {
	expanded: boolean;
	scale: number;
	devices: DemoDevices;
}) {
	return (
		<div
			className="device-island absolute bottom-0 left-1/2 z-[6] h-[50px] w-[96px] origin-bottom"
			style={{ transform: "translateX(-50%)", zoom: scale }}
		>
			<WorkspaceDockSurface
				expanded={expanded}
				width={expanded ? 400 : 96}
				height={expanded ? 400 : 50}
				controls={
					<>
						<DockIconButton
							label={`Devices, ${devices.shown} shown`}
							active={expanded}
							badge={devices.shown}
						>
							<MonitorSmartphone size={17} strokeWidth={1.9} />
						</DockIconButton>
						<DockIconButton label="Device settings">
							<Settings size={17} strokeWidth={1.9} />
						</DockIconButton>
					</>
				}
			>
				<AnimatePresence initial={false} mode="popLayout" custom={-1}>
					{expanded && (
						<motion.div
							key="devices"
							custom={-1}
							variants={ISLAND_PANEL_VARIANTS}
							initial="enter"
							animate="center"
							exit="exit"
							transition={ISLAND_PANEL_TRANSITION}
							className="absolute inset-0 flex min-h-0 flex-col text-white/90"
						>
							<div className="flex min-h-11 shrink-0 items-center justify-between px-3 text-xs font-semibold text-card-foreground">
								<span>Devices</span>
								<div className="flex items-center gap-1.5">
									<small>
										<NumberMorph>{devices.shown}</NumberMorph> shown
									</small>
									<span className="grid size-8 place-items-center text-white/42">
										<RotateCcw size={14} strokeWidth={2} />
									</span>
								</div>
							</div>
							<DeviceList devices={devices} />
						</motion.div>
					)}
				</AnimatePresence>
			</WorkspaceDockSurface>
		</div>
	);
}
