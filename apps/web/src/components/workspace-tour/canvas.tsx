import { AnimatePresence, motion } from "motion/react";
import { GripVertical, RotateCcw } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { useRef, type CSSProperties } from "react";
import {
	AX_ROWS,
	FORM_ASPECT,
	IPHONE_FILE,
	IPHONE_ID,
	IPHONE_SCREEN,
	PIXEL_FILE,
	SCREENS,
	SCREEN_SRC,
	STREAM_TARGETS,
	type AxRow,
	type IPhoneScreen,
	type TourDevice,
} from "./data";
import { NAMEBAR_H, STACK_GAP, type CanvasLayout, type DeviceColumn, type TourDesign } from "./layout";
import { ProductIcon } from "./product-icon";
import { targetProps } from "./dock";
import { DRAG, DRAG_EASE } from "./script";
import { useScreenSrc } from "./screens";
import type { TourState } from "./state";
import { T } from "./targets";

const FRAME_TOP = NAMEBAR_H + STACK_GAP;

/** The iPhone 17 screen inside its hardware frame, as the product places it. */
const IPHONE_SCREEN_BOX = { left: 0.0572687, top: 0.0187225, width: 0.885463, height: 0.962555 };

/** The canvas: the devices, the notes on them, and the note composer. */
export function DeviceCanvas({
	design,
	state,
	layout,
	devices,
}: {
	design: TourDesign;
	state: TourState;
	layout: CanvasLayout;
	devices: TourDevice[];
}) {
	// A device that leaves keeps its last column while it fades out.
	const lastColumns = useRef(new Map<string, DeviceColumn>());
	for (const column of layout.columns) lastColumns.current.set(column.id, column);
	return (
		<div className="wt-canvas-devices">
			<AnimatePresence initial={false}>
				{devices.map((device) => (
					<DeviceColumnView
						key={device.id}
						device={device}
						column={layout.columns.find((c) => c.id === device.id) ?? lastColumns.current.get(device.id)!}
						baseH={layout.baseH}
						state={state}
					/>
				))}
			</AnimatePresence>
			<NotePins state={state} layout={layout} />
			<Composer design={design} state={state} layout={layout} />
		</div>
	);
}

/** While a device is carried, it rides with the hand: the same time and curve as the cursor. */
const CARRIED: CSSProperties = { transition: `transform ${DRAG}ms cubic-bezier(${DRAG_EASE.join(",")})` };

function DeviceColumnView({
	device,
	column,
	baseH,
	state,
}: {
	device: TourDevice;
	column: DeviceColumn;
	baseH: number;
	state: TourState;
}) {
	const baseW = FORM_ASPECT[device.form] * baseH;
	const groupH = FRAME_TOP + column.frameH + STACK_GAP;
	const carried = device.id === IPHONE_ID && state.canvas.dragging;
	return (
		<div
			className="wt-col"
			style={{ transform: `translate(${column.x}px, ${column.top}px)`, ...(carried ? CARRIED : null) }}
		>
			<motion.div
				className="wt-col-presence"
				style={{ transformOrigin: `0px ${groupH / 2}px` }}
				initial={{ opacity: 0, scale: 0.96 }}
				animate={{ opacity: 1, scale: 1 }}
				exit={{ opacity: 0, scale: 0.96 }}
				// DEVICE_PRESENCE_TRANSITION in the product: spring, no bounce, 180ms.
				transition={{ type: "spring", bounce: 0, duration: 0.18 }}
			>
				<NameBar device={device} fps={state.fps[device.id] ?? 0} />
				<div
					className="wt-frame"
					style={
						{
							width: baseW,
							height: baseH,
							left: -baseW / 2,
							top: FRAME_TOP,
							transform: `scale(${column.scale})`,
							"--inv": 1 / column.scale,
						} as CSSProperties
					}
				>
					{device.id === IPHONE_ID ? <IPhoneFrame state={state} /> : <AndroidFrame device={device} />}
				</div>
				<ResizeArc iphone={device.form === "iphone"} x={column.frameW / 2} y={FRAME_TOP + column.frameH} />
				<DeviceToolbar device={device} state={state} y={FRAME_TOP + column.frameH + STACK_GAP} />
			</motion.div>
		</div>
	);
}

/**
 * The name bar above a device: grip, name, and the stream status
 * (stream-status-pill.tsx). Before the first frame the status is the
 * player's, with the retry button beside it.
 */
function NameBar({ device, fps }: { device: TourDevice; fps: number }) {
	const { status } = device;
	const streaming = status === "streaming";
	const label =
		status === "booting" ? "Booting" : status === "shutting-down" ? "Shutting down" : "Waiting for video";
	return (
		<div className="wt-namebar">
			<span className="wt-grip" data-target={T.grip(device.id)}>
				<GripVertical size={13} strokeWidth={1.8} className="shrink-0 text-white/32" />
			</span>
			<span className="max-w-[230px] truncate text-[12px] font-semibold text-white/92">{device.name}</span>
			<span className="inline-flex min-w-[108px] shrink-0 items-center justify-end whitespace-nowrap text-[11px] leading-none">
				{streaming ? (
					<span className="min-w-[7ch] text-right font-mono text-[11px] font-medium leading-none tabular-nums text-white/38">
						{fps} FPS
					</span>
				) : (
					<span className="text-right text-[11px] font-medium leading-none text-white/45">{label}</span>
				)}
			</span>
			{!streaming && status !== "shutting-down" ? (
				<span className="grid size-4 shrink-0 place-items-center rounded-lg text-white/55">
					<RotateCcw size={13} strokeWidth={2} />
				</span>
			) : null}
		</div>
	);
}

/** The action toolbar under a device. Android adds Back; annotate mode disables Back and Home. */
function DeviceToolbar({ device, state, y }: { device: TourDevice; state: TourState; y: number }) {
	const icon = (name: "back" | "home" | "screenshot" | "record", disabled = false) => (
		<span className="wt-devbar-icon" data-disabled={disabled || undefined} {...targetProps(state, T.toolbarButton(device.id, name))}>
			<ProductIcon name={name} size={18} />
		</span>
	);
	return (
		<div className="wt-devbar" style={{ transform: `translate(-50%, ${y}px)` }}>
			{device.platform === "android" ? icon("back", state.annotate) : null}
			{icon("home", state.annotate)}
			{icon("screenshot")}
			{icon("record")}
			<span className="wt-devbar-more">
				<ProductIcon name="more" size={18} />
			</span>
		</div>
	);
}

/** The resize affordance at the lower-right corner of each device. */
function ResizeArc({ iphone, x, y }: { iphone: boolean; x: number; y: number }) {
	const size = iphone ? 33 : 29;
	const d = iphone
		? "M 28.380 14.469 A 19.098 19.098 0 0 1 14.469 28.380"
		: "M 25.245 13.939 A 15.522 15.522 0 0 1 13.939 25.245";
	return (
		<svg
			className="wt-resize-arc"
			width={size}
			height={size}
			viewBox={`0 0 ${size} ${size}`}
			fill="none"
			aria-hidden="true"
			style={{ transform: `translate(${x + 14 - size}px, ${y + 14 - size}px)` }}
		>
			<path d={d} stroke="#686e78" strokeWidth={2.65} strokeLinecap="round" />
		</svg>
	);
}

/** The screen images of iPhone 17, from the first back. `home` follows the stream's appearance. */
const IPHONE_LAYERS = [
	{ key: "home-light", src: SCREENS.homeLight },
	{ key: "home-dark", src: SCREENS.homeDark },
	...Object.entries(SCREEN_SRC).map(([key, src]) => ({ key, src })),
];

function shownLayer(state: TourState) {
	if (state.screen === "home") return state.dark ? "home-dark" : "home-light";
	return state.screen;
}

function IPhoneFrame({ state }: { state: TourState }) {
	return (
		<div className="absolute inset-0">
			<img className="wt-iphone-btn" style={{ top: "17.6211%", height: "3.74449%" }} src="/iphone-action.webp" alt="" />
			<img className="wt-iphone-btn" style={{ top: "24.3392%", height: "7.04846%" }} src="/iphone-volume.webp" alt="" />
			<img className="wt-iphone-btn" style={{ top: "33.0396%", height: "7.04846%" }} src="/iphone-volume.webp" alt="" />
			<img
				className="wt-iphone-btn"
				style={{ top: "28.8546%", left: "95.1542%", height: "11.1233%" }}
				src="/iphone-power.webp"
				alt=""
			/>
			<img className="wt-iphone-frame" src="/iphone-frame.webp" alt="" />
			<div className="wt-iphone-screen">
				<IPhoneStream state={state} />
				<StreamTargets screen={state.screen} />
				<ElementLayer state={state} />
				{state.touch ? (
					<span
						className="wt-touch"
						style={{
							left: `${(state.touch.x / IPHONE_SCREEN.width) * 100}%`,
							top: `${(state.touch.y / IPHONE_SCREEN.height) * 100}%`,
						}}
					/>
				) : null}
			</div>
		</div>
	);
}

/**
 * The stream. The newest screen fades in over the one before, which leaves
 * only once it is covered, so a change never shows black. A black frame is
 * the stream going black while an app opens.
 */
function IPhoneStream({ state }: { state: TourState }) {
	const shown = shownLayer(state);
	// The stacking order: the most recent screen on top.
	const order = useRef<string[]>([]);
	if (shown !== "black" && order.current.at(-1) !== shown) {
		order.current = [...order.current.filter((key) => key !== shown), shown];
	}
	return (
		<div className="wt-stream">
			{IPHONE_LAYERS.map((layer) => (
				<StreamImage
					key={layer.key}
					src={layer.src}
					instant={layer.key.startsWith("typed-")}
					on={layer.key === shown}
					covered={shown !== "black"}
					z={order.current.indexOf(layer.key) + 1}
				/>
			))}
		</div>
	);
}

/** A key press changes the stream from one frame to the next: the typed frames swap without a fade. */
function StreamImage({
	src,
	on,
	covered,
	z,
	instant,
}: {
	src: string;
	on: boolean;
	covered: boolean;
	z: number;
	instant: boolean;
}) {
	const shownSrc = useScreenSrc(src);
	if (!shownSrc) return null;
	return (
		<img
			className="wt-screen-img wt-shot"
			src={shownSrc}
			width={IPHONE_FILE.width}
			height={IPHONE_FILE.height}
			alt=""
			data-on={on || undefined}
			data-covered={(!on && covered) || undefined}
			data-instant={instant || undefined}
			style={{ zIndex: z }}
		/>
	);
}

/** The places the pointer presses on the screen it shows, measured like any target. */
function StreamTargets({ screen }: { screen: IPhoneScreen }) {
	return (
		<>
			{Object.entries(STREAM_TARGETS)
				.filter(([, target]) => target.screen === screen)
				.map(([name, target]) => (
					<span key={name} className="wt-stream-target" data-target={T.stream(name)} style={screenFraction(target.frame)} />
				))}
		</>
	);
}

/**
 * Pixel 10 is drawn as its screen, with the display cutout, as in the
 * product. Until the stream shows, the screen is the boot gradient of the
 * phones picture (src/components/product-demo/phones.tsx), and the stream
 * fades in over it. As it shuts down, the stream dims before it leaves.
 */
function AndroidFrame({ device }: { device: TourDevice }) {
	const src = useScreenSrc(SCREENS.pixelHome);
	const opacity = device.status === "streaming" ? 1 : device.status === "shutting-down" ? 0.45 : 0;
	return (
		<div className="wt-android-screen">
			{src ? (
				<motion.img
					className="wt-screen-img"
					src={src}
					width={PIXEL_FILE.width}
					height={PIXEL_FILE.height}
					alt=""
					initial={false}
					animate={{ opacity }}
					transition={{ type: "tween", duration: 0.18, ease: "easeInOut" }}
				/>
			) : null}
			<span className="wt-cutout" />
		</div>
	);
}

function screenFraction(frame: NonNullable<AxRow["frame"]>) {
	return {
		left: `${(frame.x / IPHONE_SCREEN.width) * 100}%`,
		top: `${(frame.y / IPHONE_SCREEN.height) * 100}%`,
		width: `${(frame.width / IPHONE_SCREEN.width) * 100}%`,
		height: `${(frame.height / IPHONE_SCREEN.height) * 100}%`,
	};
}

/**
 * The elements of the app. With the Accessibility drawer open, the
 * actionable ones get the product's outline boxes; in annotate mode the
 * hovered element gets the annotation outline.
 */
function ElementLayer({ state }: { state: TourState }) {
	const inspecting = state.panel === "accessibility";
	if (state.screen !== "crema-detail" || (!inspecting && !state.annotate)) return null;
	return (
		<div className="wt-elements" data-mode={state.annotate ? "annotate" : "inspect"}>
			{AX_ROWS.filter((row) => row.frame && (state.annotate || row.actionable)).map((row) => (
				<span
					key={row.path}
					className="wt-el"
					data-target={T.element(row.path)}
					data-outlined={inspecting || undefined}
					data-hovered={state.hovered === row.path || undefined}
					data-selected={state.selected === row.path || undefined}
					style={screenFraction(row.frame!)}
				/>
			))}
		</div>
	);
}

/** Canvas coordinates of an iPhone element, from the layout. */
function elementBox(layout: CanvasLayout, path: string) {
	const column = layout.columns.find((c) => c.id === IPHONE_ID);
	const frame = AX_ROWS.find((r) => r.path === path)?.frame;
	if (!column || !frame) return null;
	const left = column.x - column.frameW / 2 + IPHONE_SCREEN_BOX.left * column.frameW;
	const top = column.top + FRAME_TOP + IPHONE_SCREEN_BOX.top * column.frameH;
	const sx = (IPHONE_SCREEN_BOX.width * column.frameW) / IPHONE_SCREEN.width;
	const sy = (IPHONE_SCREEN_BOX.height * column.frameH) / IPHONE_SCREEN.height;
	return { x: left + frame.x * sx, y: top + frame.y * sy, width: frame.width * sx, height: frame.height * sy };
}

/** A numbered pin at the lower-right corner of each noted element. Copy prompt takes it away at once. */
function NotePins({ state, layout }: { state: TourState; layout: CanvasLayout }) {
	return (
		<>
			{state.notes.map((note, index) => {
				const box = elementBox(layout, note.path);
				if (!box) return null;
				return (
					<div
						key={note.id}
						className="wt-pin-slot"
						style={{ transform: `translate(${box.x + box.width}px, ${box.y + box.height}px)` }}
					>
						<motion.span
							className="wt-pin"
							initial={{ opacity: 0, scale: 0.6 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{ type: "spring", bounce: 0, duration: 0.2 }}
						>
							{index + 1}
						</motion.span>
					</div>
				);
			})}
		</>
	);
}

/** The note composer, under the selected element, as the product places it (live-annotation-surface.tsx). */
function Composer({ design, state, layout }: { design: TourDesign; state: TourState; layout: CanvasLayout }) {
	const box = state.annotate && state.selected ? elementBox(layout, state.selected) : null;
	const open = state.draft !== null && !!box;
	const width = Math.min(320, design.viewW - 24);
	const below = box ? box.y + box.height + 8 : 0;
	const position = box
		? {
				// The canvas is at least design.viewW wide, centered on the origin.
				left: Math.max(12 - design.viewW / 2, Math.min(design.viewW / 2 - width - 12, box.x + box.width / 2 - width / 2)),
				top: Math.max(12, Math.min(layout.canvasH - 52, below > layout.canvasH - 52 ? box.y - 48 : below)),
			}
		: null;
	const text = state.draft ?? "";
	return (
		<AnimatePresence>
			{open && position ? (
				<motion.div
					key={state.selected}
					className="wt-composer"
					style={{ width, left: position.left, top: position.top }}
					initial={{ opacity: 0, y: -4, scale: 0.97 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, scale: 0.97 }}
					transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
				>
					<div className="flex items-center gap-1">
						<span className="wt-composer-text" data-empty={!text || undefined}>
							{text || "What should change?"}
						</span>
						<span className="wt-composer-send" data-disabled={!text.trim() || undefined}>
							<HugeiconsIcon icon={ArrowUp02Icon} size={16} strokeWidth={1.5} />
						</span>
					</div>
				</motion.div>
			) : null}
		</AnimatePresence>
	);
}
