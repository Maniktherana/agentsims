import { GripVertical } from "lucide-react";
import { motion } from "motion/react";
import { ResizeHandle } from "./resize-handle";
import { SURFACE } from "./motion";
import { INTRO_ENTRANCE } from "../intro/use-intro";
import { cn } from "@agentsims/ui/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

const IPHONE_BUTTON = "absolute z-0 left-[0.881%] w-[3.524%]";
export const IPHONE_SHADOW =
	"drop-shadow-[0_14px_12px_oklch(0_0_0/0.533333)]";

export function IPhoneMock({
	name = "iPhone 17",
	labelScale = 1,
	className,
	children,
	...props
}: HTMLAttributes<HTMLDivElement> & {
	name?: string;
	labelScale?: number | string;
	children?: ReactNode;
}) {
	return (
		<div
			className={cn(
				"relative aspect-[454/908] flex-none",
				IPHONE_SHADOW,
				className,
			)}
			{...props}
		>
			<DeviceNamePill name={name} scale={labelScale} />
			<div className="absolute top-[1.872%] left-[5.727%] z-0 h-[96.256%] w-[88.546%] rounded-[15.174%/6.979%] bg-linear-[155deg,oklch(0.224584_0.026372_258.317),oklch(0.189824_0.027443_258.29)_52%,oklch(0.157319_0.017155_256.284)]" />
			{children}
			<img
				className="pointer-events-none absolute inset-y-0 left-[1.982%] z-[1] h-full w-[96.035%]"
				src="/iphone-frame.webp"
				alt=""
			/>
			<img
				className={cn(IPHONE_BUTTON, "top-[17.621%] h-[3.744%]")}
				src="/iphone-action.webp"
				alt=""
			/>
			<img
				className={cn(IPHONE_BUTTON, "top-[24.339%] h-[7.048%]")}
				src="/iphone-volume.webp"
				alt=""
			/>
			<img
				className={cn(IPHONE_BUTTON, "top-[33.04%] h-[7.048%]")}
				src="/iphone-volume.webp"
				alt=""
			/>
			<img
				className={cn(
					IPHONE_BUTTON,
					"top-[28.855%] left-[95.154%] h-[11.123%]",
				)}
				src="/iphone-power.webp"
				alt=""
			/>
		</div>
	);
}

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
				className="relative w-[46cqw] flex-none aspect-[454/908]"
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
				<IPhoneMock className="h-full w-full" labelScale={scale}>
					<ResizeHandle android={false} scale={scale} />
					<img
						className="absolute top-[1.872%] left-[5.727%] z-[2] h-[96.256%] w-[88.546%] rounded-[15.174%/6.979%]"
						src="/demo/iphone-17-screen.webp"
						width={1206}
						height={2622}
						alt=""
					/>
				</IPhoneMock>
			</motion.div>
			{/* Pixel_10 AVD: 1080 × 2424, with the circular display cutout. */}
			<motion.div
				className="relative w-[42.5cqw] flex-none aspect-[1080/2424] rounded-[14%/6.24%] bg-linear-[155deg,oklch(0.224584_0.026372_258.317),oklch(0.189824_0.027443_258.29)_52%,oklch(0.157319_0.017155_256.284)] shadow-[inset_0_1px_0_oklch(1_0_0/0.070588),inset_0_0_0_1px_oklch(1_0_0/0.141176),0_14px_24px_oklch(0_0_0/0.533333)]"
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
						src="/demo/pixel-10-screen.webp"
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
export function DeviceNamePill({
	name,
	scale,
}: {
	name: string;
	scale: number | string;
}) {
	return (
		<div
			className="device-name-pill absolute bottom-[calc(100%+2cqw)] left-1/2 flex w-[220px] origin-bottom items-center gap-2.5 rounded-[10px] border border-[oklch(1_0_0/0.09)] bg-popover px-2.5 py-1.5 whitespace-nowrap"
			style={{ transform: `translateX(-50%) scale(${scale})` }}
		>
			<GripVertical
				size={13}
				strokeWidth={1.8}
				className="shrink-0 text-[oklch(1_0_0/0.32)]"
			/>
			<span className="text-[12px] font-semibold text-[oklch(1_0_0/0.92)]">
				{name}
			</span>
		</div>
	);
}
