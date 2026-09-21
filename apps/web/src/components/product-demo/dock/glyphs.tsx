import { motion, useReducedMotion } from "motion/react";
import type { DeviceType, DevicePhase } from "./devices";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { IconSwap } from "@agentsims/ui/motion/icon-swap";

const SCREEN_ON_FILL = "var(--agentsims-device-screen-on)";

// Device-family glyphs for the landing demo.
export function DeviceGlyph({
	type,
	size = 20,
	screenOn = false,
}: {
	type: DeviceType;
	size?: number;
	screenOn?: boolean;
}) {
	const reducedMotion = useReducedMotion();
	const common = {
		width: size,
		height: size,
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		strokeWidth: 1.6,
		strokeLinecap: "round" as const,
		strokeLinejoin: "round" as const,
	};
	switch (type) {
		case "ipad":
			return (
				<svg {...common}>
					<motion.rect
						initial={false}
						animate={{ opacity: screenOn ? 1 : 0 }}
						transition={{
							duration: reducedMotion ? 0 : 0.25,
							ease: "easeInOut",
						}}
						x="5"
						y="3"
						width="15"
						height="19"
						rx="1.65"
						fill={SCREEN_ON_FILL}
						stroke="none"
						data-testid={screenOn ? "device-glyph-screen-on" : undefined}
					/>
					<rect x="4" y="2.5" width="16" height="19" rx="2.5" />
					<line x1="12" y1="18.5" x2="12" y2="18.5" />
				</svg>
			);
		case "watch":
			return (
				<svg {...common}>
					<rect x="6.5" y="7" width="11" height="10" rx="3" />
					<path d="M8.5 7l.6-3.2A1.5 1.5 0 0 1 10.6 2.5h2.8a1.5 1.5 0 0 1 1.5 1.3L15.5 7" />
					<path d="M8.5 17l.6 3.2a1.5 1.5 0 0 0 1.5 1.3h2.8a1.5 1.5 0 0 0 1.5-1.3l.6-3.2" />
				</svg>
			);
		case "vision":
			return (
				<svg {...common}>
					<path d="M3 11a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v2.5a2.5 2.5 0 0 1-2.5 2.5c-1.8 0-2.5-1.2-3.5-1.8-.9-.5-1.6-.7-2.5-.7s-1.6.2-2.5.7c-1 .6-1.7 1.8-3.5 1.8A2.5 2.5 0 0 1 3 13.5z" />
				</svg>
			);
		case "android":
			return (
				<svg {...common}>
					<motion.rect
						initial={false}
						animate={{ opacity: screenOn ? 1 : 0 }}
						transition={{
							duration: reducedMotion ? 0 : 0.25,
							ease: "easeInOut",
						}}
						x="6"
						y="2.75"
						width="12"
						height="18.5"
						rx="2.4"
						fill={SCREEN_ON_FILL}
						stroke="none"
						data-testid={screenOn ? "device-glyph-screen-on" : undefined}
					/>
					<rect x="6" y="2.5" width="12" height="19" rx="3" />
					<circle cx="12" cy="5" r="0.85" />
					<line x1="10.25" y1="18.5" x2="13.75" y2="18.5" />
				</svg>
			);
		default:
			return (
				<svg {...common}>
					<motion.rect
						initial={false}
						animate={{ opacity: screenOn ? 1 : 0 }}
						transition={{
							duration: reducedMotion ? 0 : 0.25,
							ease: "easeInOut",
						}}
						x="6"
						y="3"
						width="11"
						height="19"
						rx="2"
						fill={SCREEN_ON_FILL}
						stroke="none"
						data-testid={screenOn ? "device-glyph-screen-on" : undefined}
					/>
					<rect x="6.5" y="2.5" width="11" height="19" rx="2.8" />
					<line x1="10.5" y1="5" x2="13.5" y2="5" />
				</svg>
			);
	}
}

export function DeviceStatusGlyph({ phase }: { phase: DevicePhase }) {
	if (phase === "available") return null;
	return (
		<span
			aria-hidden="true"
			data-device-status-anchor
			data-device-status-glyph={phase}
			className={`pointer-events-none absolute -bottom-2 -right-2 grid size-4 place-items-center ${
				phase === "streaming"
					? "text-[oklch(0.772944_0.15349_163.223)]"
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
