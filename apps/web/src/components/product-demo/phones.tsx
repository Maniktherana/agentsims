import { GripVertical } from "lucide-react";
import { motion } from "motion/react";
import { ResizeHandle } from "./resize-handle";
import { SURFACE } from "./motion";
import { INTRO_ENTRANCE } from "../intro/use-intro";
import { cn } from "../../lib/utils";

const IPHONE_BUTTON = "absolute z-0 left-[0.881%] w-[3.524%]";

export function DemoPhones({
	iphoneVisible,
	androidVisible,
	androidStreaming,
	scale,
}: {
	iphoneVisible: boolean;
	androidVisible: boolean;
	androidStreaming: boolean;
	scale: number;
}) {
	return (
		<div className="absolute top-0 left-0 flex w-full items-center justify-center gap-[5cqw]">
			<motion.div
				className="relative w-[46cqw] flex-none aspect-[454/908] drop-shadow-[0_14px_12px_#0008]"
				initial={false}
				animate={{
					x: androidVisible ? "0%" : "51.63%",
					opacity: iphoneVisible ? 1 : 0,
					y: iphoneVisible ? 0 : SURFACE.enterY,
					scale: iphoneVisible ? 1 : SURFACE.enterScale,
				}}
				// The intro entrance eases in slowly; the storyboard's slide keeps
				// the shared spring, so only the first appearance is softened.
				transition={{
					x: SURFACE.spring,
					opacity: INTRO_ENTRANCE,
					y: INTRO_ENTRANCE,
					scale: INTRO_ENTRANCE,
				}}
			>
				<DeviceNamePill name="iPhone 17" scale={scale} />
				<ResizeHandle android={false} scale={scale} />
				<img
					className="absolute top-[1.872%] left-[5.727%] z-[2] h-[96.256%] w-[88.546%] rounded-[15.174%/6.979%] bg-linear-[155deg,#141c28,#0c1420_52%,#080d14]"
					src="/demo/iphone-17-screen.png"
					width={1206}
					height={2622}
					alt=""
				/>
				<img
					className="absolute inset-y-0 left-[1.982%] z-[1] h-full w-[96.035%]"
					src="/iphone-frame.png"
					alt=""
				/>
				<img
					className={cn(IPHONE_BUTTON, "top-[17.621%] h-[3.744%]")}
					src="/iphone-action.png"
					alt=""
				/>
				<img
					className={cn(IPHONE_BUTTON, "top-[24.339%] h-[7.048%]")}
					src="/iphone-volume.png"
					alt=""
				/>
				<img
					className={cn(IPHONE_BUTTON, "top-[33.04%] h-[7.048%]")}
					src="/iphone-volume.png"
					alt=""
				/>
				<img
					className={cn(
						IPHONE_BUTTON,
						"top-[28.855%] left-[95.154%] h-[11.123%]",
					)}
					src="/iphone-power.png"
					alt=""
				/>
			</motion.div>
			{/* Pixel_10 AVD: 1080 × 2424, with the circular display cutout. */}
			<motion.div
				className="relative w-[42.5cqw] flex-none aspect-[1080/2424] rounded-[14%/6.24%] bg-linear-[155deg,#141c28,#0c1420_52%,#080d14] shadow-[inset_0_1px_0_#ffffff12,inset_0_0_0_1px_#ffffff24,0_14px_24px_#0008]"
				initial={false}
				animate={{
					opacity: androidVisible ? 1 : 0,
					y: androidVisible ? 0 : SURFACE.enterY,
					scale: androidVisible ? 1 : SURFACE.enterScale,
				}}
			>
				<DeviceNamePill name="Pixel 10" scale={scale} />
				<motion.img
					className="pointer-events-none absolute inset-px h-[calc(100%-2px)] w-[calc(100%-2px)] rounded-[inherit] object-cover"
					src="/demo/pixel-10-screen.png"
					width={1080}
					height={2424}
					alt=""
					initial={false}
					animate={{ opacity: androidStreaming ? 1 : 0 }}
					transition={{ type: "tween", duration: 0.18, ease: "easeInOut" }}
				/>
				<span className="absolute top-[1.8%] left-1/2 z-[1] aspect-square w-[7.7%] -translate-x-1/2 rounded-full bg-black" />
				<ResizeHandle android scale={scale} />
			</motion.div>
		</div>
	);
}

// Display-only name bar; this demo does not show FPS.
function DeviceNamePill({ name, scale }: { name: string; scale: number }) {
	return (
		<div
			className="absolute bottom-[calc(100%+2cqw)] left-1/2 flex w-[220px] origin-bottom items-center gap-2.5 rounded-[10px] border border-white/[0.09] bg-popover px-2.5 py-1.5 whitespace-nowrap"
			style={{ transform: `translateX(-50%) scale(${scale})` }}
		>
			<GripVertical
				size={13}
				strokeWidth={1.8}
				className="shrink-0 text-white/32"
			/>
			<span className="text-[12px] font-semibold text-white/92">{name}</span>
		</div>
	);
}
