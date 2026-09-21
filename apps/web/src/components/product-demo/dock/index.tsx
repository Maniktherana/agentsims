import { AnimatePresence, motion } from "motion/react";
import { MonitorSmartphone, RotateCcw, Settings } from "lucide-react";
import { NumberMorph } from "@agentsims/ui/motion/number-morph";
import { DeviceList } from "./device-list";
import { Button } from "@agentsims/ui/components/button";
import type { DemoDevices } from "./devices";
import { INTRO_FADE } from "../../intro/use-intro";
import { WorkspaceDockSurface } from "./surface";
import {
	dockPanelTransition,
	dockPanelVariants,
} from "@agentsims/ui/motion/presets";

export function DemoDock({
	visible,
	expanded,
	scale,
	devices,
}: {
	visible: boolean;
	expanded: boolean;
	scale: number;
	devices: DemoDevices;
}) {
	return (
		<motion.div
			className="device-island absolute bottom-0 left-1/2 z-[6] h-[50px] w-[96px] origin-bottom"
			style={{ transform: "translateX(-50%)", zoom: scale }}
			initial={{ opacity: 0 }}
			animate={{ opacity: visible ? 1 : 0 }}
			transition={INTRO_FADE}
		>
			<WorkspaceDockSurface
				expanded={expanded}
				width={expanded ? 400 : 96}
				height={expanded ? 400 : 50}
				controls={
					<>
						<Button
							aria-label={`Devices, ${devices.shown} shown`}
							aria-pressed={expanded}
							variant="dock"
							size="icon-lg"
							className="relative"
						>
							<MonitorSmartphone size={17} strokeWidth={1.9} />
							<span
								aria-hidden="true"
								className="absolute -right-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-brand px-1 text-[9px] font-semibold leading-[18px] tabular-nums text-white shadow-[0_2px_8px_oklch(0_0_0/0.42)]"
							>
								<NumberMorph>{devices.shown}</NumberMorph>
							</span>
						</Button>
						<Button aria-label="Device settings" variant="dock" size="icon-lg">
							<Settings size={17} strokeWidth={1.9} />
						</Button>
					</>
				}
			>
				<AnimatePresence initial={false} mode="popLayout" custom={-1}>
					{expanded && (
						<motion.div
							key="devices"
							custom={-1}
							variants={dockPanelVariants}
							initial="enter"
							animate="center"
							exit="exit"
							transition={dockPanelTransition}
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
		</motion.div>
	);
}
