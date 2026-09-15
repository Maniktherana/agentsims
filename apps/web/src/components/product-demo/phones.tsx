import { GripVertical } from "lucide-react";
import { motion } from "motion/react";
import { ResizeHandle } from "./resize-handle";
import { SURFACE } from "./motion";

export function DemoPhones({
	androidVisible,
	androidStreaming,
	scale,
}: {
	androidVisible: boolean;
	androidStreaming: boolean;
	scale: number;
}) {
	return (
		<div className="phone-group">
			<motion.div
				className="ios-phone"
				initial={false}
				animate={{ x: androidVisible ? "0%" : "51.63%" }}
			>
				<DeviceNamePill name="iPhone 17" scale={scale} />
				<ResizeHandle android={false} scale={scale} />
				<img
					className="ios-screen-fill"
					src="/demo/iphone-17-screen.png"
					width={1206}
					height={2622}
					alt=""
				/>
				<img className="iphone-frame" src="/iphone-frame.png" alt="" />
				<img
					className="iphone-button action-button"
					src="/iphone-action.png"
					alt=""
				/>
				<img
					className="iphone-button volume-up-button"
					src="/iphone-volume.png"
					alt=""
				/>
				<img
					className="iphone-button volume-down-button"
					src="/iphone-volume.png"
					alt=""
				/>
				<img
					className="iphone-button power-button"
					src="/iphone-power.png"
					alt=""
				/>
			</motion.div>
			<motion.div
				className="android-screen"
				initial={false}
				animate={{
					opacity: androidVisible ? 1 : 0,
					y: androidVisible ? 0 : SURFACE.enterY,
					scale: androidVisible ? 1 : SURFACE.enterScale,
				}}
			>
				<DeviceNamePill name="Pixel 10" scale={scale} />
				<motion.img
					className="android-screen-image"
					src="/demo/pixel-10-screen.png"
					width={1080}
					height={2424}
					alt=""
					initial={false}
					animate={{ opacity: androidStreaming ? 1 : 0 }}
					transition={{ type: "tween", duration: 0.18, ease: "easeInOut" }}
				/>
				<span className="android-camera" />
				<ResizeHandle android scale={scale} />
			</motion.div>
		</div>
	);
}

// Display-only name bar; this demo does not show FPS.
function DeviceNamePill({ name, scale }: { name: string; scale: number }) {
	return (
		<div
			className="device-name-pill"
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
