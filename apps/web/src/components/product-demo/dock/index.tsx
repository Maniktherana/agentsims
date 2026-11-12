import { AnimatePresence, motion } from "motion/react";
import { MonitorSmartphone, RotateCcw, Settings } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AccessibilityIcon,
	Cursor01Icon,
	TextAlignLeftIcon,
	WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";
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

/** The closed and the open size of the dock in the product
 * (packages/agentsims/src/web/components/workspace/workspace-header.tsx). */
const DOCK_CLOSED = { width: 266, height: 50 };
const DOCK_OPEN = { width: 420, height: 400 };

type DockTool = "devices" | "settings" | "annotate" | "accessibility" | "logs" | "traces";

/**
 * The six buttons of the dock in the product, in its order, with its icons
 * and sizes (workspace-header.tsx). `pressed` is the button that is on.
 */
function DockControls({
	count,
	pressed,
}: {
	count: number;
	pressed: DockTool | null;
}) {
	return (
		<>
			<Button
				aria-label={`Devices, ${count} shown`}
				aria-pressed={pressed === "devices"}
				variant="dock"
				size="icon-lg"
				className="relative"
			>
				<MonitorSmartphone size={17} strokeWidth={1.9} />
				<span
					aria-hidden="true"
					className="absolute -right-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-[var(--agentsims-accent)] px-1 text-[9px] font-semibold leading-[18px] tabular-nums text-white shadow-[0_2px_8px_rgba(0,0,0,0.42)]"
				>
					<NumberMorph>{count}</NumberMorph>
				</span>
			</Button>
			<Button aria-label="Device settings" aria-pressed={pressed === "settings"} variant="dock" size="icon-lg">
				<Settings size={17} strokeWidth={1.9} />
			</Button>
			<Button aria-label="Annotate" aria-pressed={pressed === "annotate"} variant="dock" size="icon-lg">
				<HugeiconsIcon icon={Cursor01Icon} size={18} />
			</Button>
			<Button aria-label="Accessibility tree" aria-pressed={pressed === "accessibility"} variant="dock" size="icon-lg">
				<HugeiconsIcon icon={AccessibilityIcon} size={18} />
			</Button>
			<Button aria-label="Logs" aria-pressed={pressed === "logs"} variant="dock" size="icon-lg">
				<HugeiconsIcon icon={TextAlignLeftIcon} size={18} />
			</Button>
			<Button aria-label="Traces" aria-pressed={pressed === "traces"} variant="dock" size="icon-lg">
				<HugeiconsIcon icon={WorkflowCircle01Icon} size={18} />
			</Button>
		</>
	);
}

/**
 * The dock of the workspace: the six buttons of the product, in its order,
 * with its icons. `expanded` opens the device list.
 */
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
		<motion.div
			className="device-island absolute bottom-0 left-1/2 z-[6] h-[50px] w-[266px] origin-bottom"
			style={{ transform: "translateX(-50%)", zoom: scale }}
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={INTRO_FADE}
		>
			<WorkspaceDockSurface
				expanded={expanded}
				width={expanded ? DOCK_OPEN.width : DOCK_CLOSED.width}
				height={expanded ? DOCK_OPEN.height : DOCK_CLOSED.height}
				controls={<DockControls count={devices.shown} pressed={expanded ? "devices" : null} />}
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
							<div className="flex h-11 shrink-0 items-center justify-between px-4">
								<span className="text-[12px] font-medium text-white/75">
									Devices
								</span>
								<div className="flex items-center gap-1.5">
									<span className="text-[10px] tabular-nums text-white/35">
										<NumberMorph>{devices.shown}</NumberMorph> shown
									</span>
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
