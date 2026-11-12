import { animate, motion, useMotionValue } from "motion/react";
import { useLayoutEffect } from "react";

/**
 * What the pointer looks like where it is: the arrow, the open hand of
 * `cursor: grab` over a device grip, the product's own circle over a stream
 * (simulator-view.tsx, FINGER_CURSOR), or `cursor: row-resize` over the
 * drawer handle.
 */
export type CursorKind = "arrow" | "grab" | "finger" | "resize";

/** The tip of the arrow is inset 3.58 units of its 24-unit viewBox. */
export const TIP = 3.58 / 24;
/** The open hand draws a little larger than the arrow, as macOS draws it; its hotspot is 11.7, 10.4 of 26. */
const HAND = 26 / 24;
const HAND_SPOT = { x: 11.7 / 26, y: 10.4 / 26 };

const TRAVEL = { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as const };

/**
 * The pointer. `x` and `y` are the hotspot, in design pixels; `size` is its
 * size in design pixels, 24px on the page. It travels in 450ms, or over the
 * given `travel` when it carries a device.
 */
export function TourCursor({
	x,
	y,
	pressed,
	kind,
	size,
	travel = TRAVEL,
}: {
	x: number;
	y: number;
	pressed: boolean;
	kind: CursorKind;
	size: number;
	travel?: { duration: number; ease: readonly [number, number, number, number] };
}) {
	const mx = useMotionValue(x);
	const my = useMotionValue(y);
	// A carried thing sets the pointer in the same frame as itself; a move travels.
	useLayoutEffect(() => {
		if (travel.duration === 0) {
			mx.set(x);
			my.set(y);
			return;
		}
		const ax = animate(mx, x, travel);
		const ay = animate(my, y, travel);
		return () => {
			ax.stop();
			ay.stop();
		};
	}, [x, y, travel, mx, my]);
	return (
		<motion.div className="absolute top-0 left-0" style={{ width: 0, height: 0, x: mx, y: my }}>
			<motion.div
				className="wt-cursor drop-shadow-[0_2px_2px_oklch(0_0_0/0.533333)]"
				data-on={kind === "arrow" || undefined}
				style={{ width: size, height: size, left: -TIP * size, top: -TIP * size, originX: TIP, originY: TIP }}
				initial={false}
				animate={{ scale: pressed ? 0.9 : 1 }}
				transition={{ duration: 0.1 }}
			>
				<svg className="block h-full w-full" viewBox="0 0 24 24" aria-hidden="true">
					<path
						d="M18.5762 8.94287L4.87859 3.58295C4.06653 3.26519 3.26519 4.06653 3.58295 4.8786L8.94287 18.5762C9.20565 19.2477 10.0713 19.4288 10.5812 18.9189L12.1465 17.3536C12.3417 17.1583 12.6583 17.1583 12.8536 17.3536L16.6465 21.1465C16.8417 21.3417 17.1583 21.3417 17.3536 21.1465L21.1465 17.3536C21.3417 17.1583 21.3417 16.8417 21.1465 16.6465L17.3536 12.8536C17.1583 12.6583 17.1583 12.3417 17.3536 12.1465L18.9189 10.5812C19.4288 10.0713 19.2477 9.20565 18.5762 8.94287Z"
						fill="black"
						stroke="white"
						strokeLinecap="round"
						strokeWidth="1.5"
						strokeLinejoin="round"
					/>
				</svg>
			</motion.div>
			<div
				className="wt-cursor"
				data-on={kind === "grab" || undefined}
				style={{
					width: size * HAND,
					height: size * HAND,
					left: -HAND_SPOT.x * size * HAND,
					top: -HAND_SPOT.y * size * HAND,
				}}
			>
				<OpenHand />
			</div>
			<div
				className="wt-cursor"
				data-on={kind === "finger" || undefined}
				style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
			>
				<svg className="block h-full w-full overflow-visible" viewBox="0 0 24 24" aria-hidden="true">
					<circle
						cx="12"
						cy="12"
						r="9"
						fill="rgba(255,255,255,0.45)"
						stroke="rgba(0,0,0,0.55)"
						strokeWidth="1.25"
						style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.45))" }}
					/>
				</svg>
			</div>
			<div
				className="wt-cursor"
				data-on={kind === "resize" || undefined}
				style={{ width: size, height: size, left: -size / 2, top: -size / 2 }}
			>
				<RowResize />
			</div>
		</motion.div>
	);
}

/** The macOS up-and-down resize pointer: two rounded black triangles with a white edge, hotspot at the center. */
const RESIZE_TIPS = "M0-8.4 2.55-3.65H-2.55ZM0 8.4 2.55 3.65H-2.55Z";
function RowResize() {
	return (
		<svg className="block h-full w-full overflow-visible" viewBox="-14 -14 28 28" aria-hidden="true">
			<g strokeLinejoin="round">
				<path d={RESIZE_TIPS} fill="#fff" stroke="#fff" strokeWidth="3.2" />
				<path d={RESIZE_TIPS} fill="#000" stroke="#000" strokeWidth="1.2" />
			</g>
		</svg>
	);
}

/** The macOS open hand, the glyph of `cursor: grab`. */
function OpenHand() {
	return (
		<svg className="block h-full w-full" viewBox="0 0 32 32" fill="none" aria-hidden="true">
			<g transform="translate(7 6)">
				<path d={HAND_PATH} fill="#fff" />
				<g stroke="#000" strokeLinecap="round" strokeWidth=".75">
					<path d={HAND_PATH} strokeLinejoin="round" />
					<path d="m11.566 12.734v-3.459" />
					<path d="m9.551 12.746-.016-3.473" />
					<path d="m7.555 9.305.021 3.426" />
				</g>
			</g>
		</svg>
	);
}

const HAND_PATH =
	"m4.5557 8.5742c-.098-.375-.196-.847-.406-1.552-.167-.557-.342-.859-.47-1.233-.155-.455-.303-.721-.496-1.181-.139-.329-.364-1.048-.457-1.44-.119-.509.033-.924.244-1.206.253-.339.962-.49 1.357-.351.371.13.744.512.916.788.288.46.357.632.717 1.542.393.992.564 1.918.611 2.231l.085.452c-.001-.04-.043-1.122-.044-1.162-.035-1.029-.06-1.823-.038-2.939.002-.126.064-.587.084-.715.078-.5.305-.8.673-.979.412-.201.926-.215 1.401-.017.423.173.626.55.687 1.022.014.109.094.987.093 1.107-.013 1.025.006 1.641.015 2.174.004.231.003 1.625.017 1.469.061-.656.094-3.189.344-3.942.144-.433.405-.746.794-.929.431-.203 1.113-.07 1.404.243.285.305.446.692.482 1.153.032.405-.019.897-.02 1.245 0 .867-.021 1.324-.037 2.121-.001.038-.015.298.023.182.094-.28.188-.542.266-.745.049-.125.241-.614.359-.859.114-.234.211-.369.415-.688.2-.313.415-.448.668-.561.54-.235 1.109.112 1.301.591.086.215.009.713-.028 1.105-.061.647-.254 1.306-.352 1.648-.128.447-.274 1.235-.34 1.601-.072.394-.234 1.382-.359 1.82-.086.301-.371.978-.652 1.384 0 0-1.074 1.25-1.192 1.812-.117.563-.078.567-.101.965-.024.399.121.923.121.923s-.802.104-1.234.034c-.391-.062-.875-.841-1-1.078-.172-.328-.539-.265-.682-.023-.225.383-.709 1.07-1.051 1.113-.668.084-2.054.03-3.139.02 0 0 .185-1.011-.227-1.358-.305-.26-.83-.784-1.144-1.06l-.832-.921c-.284-.36-.629-1.093-1.243-1.985-.348-.504-1.027-1.085-1.284-1.579-.223-.425-.331-.954-.19-1.325.225-.594.675-.897 1.362-.832.519.05.848.206 1.238.537.225.19.573.534.75.748.163.195.203.276.377.509.23.307.302.459.214.121";
