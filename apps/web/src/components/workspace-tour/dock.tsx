import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Check, ChevronDown, Eye, EyeOff, MonitorSmartphone, Power, RotateCcw, Search, Settings, X } from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AccessibilityIcon,
	Cancel01Icon,
	Cursor01Icon,
	Delete02Icon,
	Message01Icon,
	PencilEdit02Icon,
	TextAlignLeftIcon,
	WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@agentsims/ui/components/button";
import { NumberMorph } from "@agentsims/ui/motion/number-morph";
import { useReducedMotionAfterHydration } from "../../hooks/use-reduced-motion-after-hydration";
import { DeviceGlyph, DeviceStatusGlyph } from "../product-demo/dock/glyphs";
import { AX_ROWS, IPHONE_FILE, IPHONE_SCREEN, SCREENS, SETTINGS_SECTIONS, SIMULATOR_SETTINGS, type TourDevice } from "./data";
import type { TourDesign } from "./layout";
import { ProductIcon, type ProductIconName } from "./product-icon";
import { DOCK_TOOLS, isDockPanel, type DockTool, type TourState } from "./state";
import { useScreenSrc } from "./screens";
import { T } from "./targets";

/** The closed dock of the product (workspace-header.tsx). */
const CLOSED = { width: 266, height: 50, radius: 10 };
const OPEN_RADIUS = 16;
/** The surface progress from which the content stands still. */
const LANDED = 0.99;
/** The border, 10% white over the canvas, drawn opaque so the shapes can overlap. */
const BORDER = "#232323";
const FILL = "#181818";

/** The hover and press states the scripted cursor gives a target. */
export function targetProps(state: TourState, name: string) {
	return {
		"data-target": name,
		"data-force-hover": state.pointerTarget === name || undefined,
		"data-force-press": state.pressTarget === name || undefined,
	};
}

export function Dock({ design, state }: { design: TourDesign; state: TourState }) {
	const reducedMotion = useReducedMotionAfterHydration();
	const open = isDockPanel(state.panel);
	// The panel keeps its last content while it closes.
	const lastPanel = useRef<"devices" | "settings">("devices");
	if (isDockPanel(state.panel)) lastPanel.current = state.panel;
	const progress = useMotionValue(open ? 1 : 0);
	useLayoutEffect(() => {
		if (reducedMotion) {
			progress.set(open ? 1 : 0);
			return;
		}
		// dockSurfaceTransition in @agentsims/ui: visualDuration 0.15.
		const animation = animate(progress, open ? 1 : 0, { type: "spring", bounce: 0.03, visualDuration: 0.15 });
		return () => animation.stop();
	}, [open, progress, reducedMotion]);
	const size = { width: design.panelW, height: design.panelH };
	// The content lands exactly when the surface is within 1% of open: the spring's
	// long tail would otherwise move its text by hundredths of a pixel, then drop it on the pixel grid.
	const contentOpacity = useTransform(progress, (p) => (p >= LANDED ? 1 : Math.max(0, (p - 0.7) / 0.3)));
	const contentY = useTransform(progress, (p) => (p >= LANDED ? 0 : 8 * Math.min(1, (1 - p) / 0.4)));
	const contentVisibility = useTransform(progress, (p) => (p < 0.02 ? "hidden" : "visible"));
	const direction = lastPanel.current === "settings" ? 1 : -1;
	return (
		<div className="wt-dock device-island">
			<MorphSurface progress={progress} open={size} />
			<div className="wt-dock-row">
				{DOCK_TOOLS.map((tool) => (
					<DockButton key={tool} tool={tool} state={state} />
				))}
			</div>
			<motion.div
				className="wt-dock-content"
				data-target={T.panel}
				style={{
					width: size.width - 2,
					height: size.height - 2 - 48,
					left: -(size.width - 2) / 2,
					opacity: reducedMotion ? (open ? 1 : 0) : contentOpacity,
					y: reducedMotion ? 0 : contentY,
					visibility: reducedMotion ? (open ? "visible" : "hidden") : contentVisibility,
				}}
			>
				<AnimatePresence initial={false} mode="popLayout" custom={direction}>
					<motion.div
						key={lastPanel.current}
						className="absolute inset-0 flex min-h-0 flex-col text-white/90"
						custom={direction}
						variants={{
							enter: (d: number) => ({ opacity: 0, x: d * 16 }),
							center: { opacity: 1, x: 0 },
							exit: (d: number) => ({ opacity: 0, x: d * -16 }),
						}}
						initial="enter"
						animate="center"
						exit="exit"
						// dockPanelTransition: 240ms, cubic-bezier(0, 0, 0.2, 1). The product also blurs 4px; the tour does not.
						transition={{ duration: 0.24, ease: [0, 0, 0.2, 1] }}
					>
						{lastPanel.current === "devices" ? (
							<DevicesPanel state={state} />
						) : (
							<SettingsPanel state={state} />
						)}
					</motion.div>
				</AnimatePresence>
			</motion.div>
		</div>
	);
}

const DRAWER_ICON = {
	annotate: Cursor01Icon,
	accessibility: AccessibilityIcon,
	logs: TextAlignLeftIcon,
	traces: WorkflowCircle01Icon,
};

function DockButton({ tool, state }: { tool: DockTool; state: TourState }) {
	const on = tool === "annotate" ? state.annotate : state.panel === tool;
	return (
		<Button
			variant="dock"
			size="icon-lg"
			className="wt-dock-btn relative"
			aria-pressed={on}
			{...targetProps(state, T.dock(tool))}
		>
			{tool === "devices" ? (
				<>
					<MonitorSmartphone size={17} strokeWidth={1.9} />
					<span className="wt-badge absolute -right-1.5 -top-1.5 grid min-w-4.5 place-items-center rounded-full bg-[var(--agentsims-accent)] px-1 text-[9px] font-semibold leading-[18px] tabular-nums text-white shadow-[0_2px_8px_rgba(0,0,0,0.42)]">
						<NumberMorph>{state.shown}</NumberMorph>
					</span>
				</>
			) : tool === "settings" ? (
				<Settings size={17} strokeWidth={1.9} />
			) : (
				<HugeiconsIcon icon={DRAWER_ICON[tool]} size={18} />
			)}
		</Button>
	);
}

type PieceKind = "h" | "v" | "bl" | "br" | "tl" | "tr";
const PIECES: readonly PieceKind[] = ["h", "v", "bl", "br", "tl", "tr"];

/**
 * The dock surface. The product animates its width, height and radius. The
 * tour draws the same rounded rectangle from two bands and four corner
 * circles, moved and scaled with transforms only, once in the border color
 * and once 1px inside in the fill.
 */
function MorphSurface({ progress, open }: { progress: MotionValue<number>; open: { width: number; height: number } }) {
	return (
		<div className="wt-dock-shape" aria-hidden="true">
			{[0, 1].map((inset) =>
				PIECES.map((kind) => (
					<ShapePiece
						key={`${inset}-${kind}`}
						kind={kind}
						progress={progress}
						inset={inset}
						color={inset ? FILL : BORDER}
						open={open}
					/>
				)),
			)}
		</div>
	);
}

function ShapePiece({
	kind,
	progress,
	inset,
	color,
	open,
}: {
	kind: PieceKind;
	progress: MotionValue<number>;
	inset: number;
	color: string;
	open: { width: number; height: number };
}) {
	const W = open.width;
	const H = open.height;
	const R = OPEN_RADIUS;
	const band = kind === "h" || kind === "v";
	const transform = useTransform(progress, (p) => {
		const w = CLOSED.width + (W - CLOSED.width) * p - inset * 2;
		const h = CLOSED.height + (H - CLOSED.height) * p - inset * 2;
		const r = CLOSED.radius + (OPEN_RADIUS - CLOSED.radius) * p - inset;
		if (band) {
			const sx = (kind === "h" ? w : w - 2 * r) / W;
			const sy = (kind === "h" ? h - 2 * r : h) / H;
			const lift = inset + (kind === "h" ? r : 0);
			return `translateY(${-lift}px) scale(${sx}, ${sy})`;
		}
		const side = kind === "bl" || kind === "tl" ? -1 : 1;
		const top = kind === "tl" || kind === "tr";
		const x = side * (w / 2 - r);
		const y = -(inset + (top ? h - r : r)) + R;
		return `translate(${x}px, ${y}px) scale(${r / R})`;
	});
	return band ? (
		<motion.span
			className="wt-piece wt-band"
			style={{ width: W, height: H, left: -W / 2, background: color, transform }}
		/>
	) : (
		<motion.span
			className="wt-piece wt-corner"
			style={{ width: R * 2, height: R * 2, left: -R, background: color, transform }}
		/>
	);
}

function StatusText({ children, className }: { children: string; className: string }) {
	return (
		<span className={`${className} grid min-w-0`}>
			<AnimatePresence initial={false} mode="wait">
				<motion.span
					key={children}
					className="truncate [grid-area:1/1]"
					initial={{ opacity: 0, y: 4 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: -4 }}
					transition={{ duration: 0.15 }}
				>
					{children}
				</motion.span>
			</AnimatePresence>
		</span>
	);
}

/** deviceLifecycleStatus in device-row.tsx. An available row shows only its runtime. */
function statusLabel(device: TourDevice) {
	const { status, runtime } = device;
	if (status === "shutting-down") return "Shutting down";
	if (status === "available") return runtime;
	const label = { booting: "Booting", connecting: "Connecting", streaming: "Streaming" }[status];
	return `${label} · ${runtime}`;
}

function glyphType(device: TourDevice) {
	return device.form === "ipad" ? "ipad" : device.platform === "android" ? "android" : "iphone";
}

function DevicesPanel({ state }: { state: TourState }) {
	const available = state.devices.filter((d) => d.status === "available");
	const running = state.devices.filter((d) => d.status !== "available");
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-11 shrink-0 items-center justify-between px-4">
				<span className="text-[12px] font-medium text-white/75">Devices</span>
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] tabular-nums text-white/35">
						<NumberMorph>{state.shown}</NumberMorph> shown
					</span>
					<span className="grid size-8 place-items-center text-white/42">
						<RotateCcw size={14} strokeWidth={2} />
					</span>
				</div>
			</div>
			<div className="wt-scroll min-h-0 flex-1 overflow-y-auto px-2 pt-2">
				<SectionLabel label="Available" count={available.length} />
				<div className="flex flex-col gap-0.5">
					{available.map((device) => (
						<DeviceRow key={device.id} device={device} state={state} />
					))}
				</div>
			</div>
			<div className="wt-scroll max-h-44 shrink-0 overflow-x-hidden overflow-y-auto border-t border-white/[0.08] px-2 py-1">
				<SectionLabel label="Running" count={running.length} />
				<div className="flex flex-col gap-0.5">
					{running.map((device) => (
						<DeviceRow key={device.id} device={device} state={state} />
					))}
				</div>
			</div>
			<div className="flex shrink-0 items-center gap-2 bg-[#181818] p-2">
				<div className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-[8px] bg-white/[0.06] px-2.5">
					<Search size={14} strokeWidth={2} className="shrink-0 text-white/35" />
					<span className="text-[12px] text-white/35">Search devices</span>
				</div>
			</div>
		</div>
	);
}

function SectionLabel({ label, count }: { label: string; count: number }) {
	return (
		<div className="wt-small flex items-center justify-between px-2 py-1.5 text-[10px] font-semibold uppercase text-white/35">
			<span>{label}</span>
			<span className="tabular-nums text-white/25">{count}</span>
		</div>
	);
}

/**
 * One device row, with the product's row classes (device-row.tsx). A running
 * row has the eye of the canvas and, once the device has booted, the power
 * button; both wait while the device changes state.
 */
function DeviceRow({ device, state }: { device: TourDevice; state: TourState }) {
	const { status } = device;
	const transitioning = status === "booting" || status === "connecting" || status === "shutting-down";
	const running = status !== "available";
	// The eye of a device that shuts down stays open until the row leaves Running.
	const visible = status === "streaming" || status === "shutting-down";
	const canShutdown = status !== "available" && status !== "booting";
	return (
		<div
			className={`wt-row relative flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 ${transitioning ? "text-white/70" : "text-white/90"}`}
			{...targetProps(state, T.row(device.id))}
		>
			<div className="relative size-9 shrink-0 overflow-visible">
				<div className="grid size-full place-items-center overflow-hidden rounded-md bg-white/6 text-white/55">
					<DeviceGlyph type={glyphType(device)} screenOn={status === "streaming"} />
				</div>
				<DeviceStatusGlyph phase={status} />
			</div>
			<div className="min-w-0 flex-1 text-left">
				<div className="truncate text-[13px] font-semibold leading-tight">{device.name}</div>
				<StatusText className={`text-[11px] leading-tight ${status === "streaming" ? "text-[#34d399]" : "text-white/45"}`}>
					{statusLabel(device)}
				</StatusText>
			</div>
			{running ? (
				<div className="flex shrink-0 items-center gap-0.5">
					<span
						className={`grid size-6 place-items-center rounded-md ${visible ? "text-white" : "text-white/55"}`}
						data-disabled={transitioning || undefined}
					>
						{visible ? <Eye size={14} strokeWidth={2} /> : <EyeOff size={14} strokeWidth={2} />}
					</span>
					{canShutdown ? (
						<span
							className="wt-power grid size-6 place-items-center rounded-md text-red-400"
							data-disabled={transitioning || undefined}
							{...targetProps(state, T.power(device.id))}
						>
							<Power size={14} strokeWidth={2} />
						</span>
					) : null}
				</div>
			) : (
				<span className="relative flex h-6 w-[72px] shrink-0 items-center justify-end">
					<span className="absolute right-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-white/40">
						{device.runtime}
					</span>
				</span>
			)}
		</div>
	);
}

/**
 * The comment summary above the dock (workspace-annotation-summary.tsx): the
 * chip, and the Comments panel that opens above it. This build of the
 * product has no Prompt detail select in the panel.
 */
export function NotesChip({ state }: { state: TourState }) {
	const count = state.notes.length;
	if (!count || isDockPanel(state.panel)) return null;
	return (
		<motion.div
			className="wt-notes"
			initial={{ opacity: 0, y: 6 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
		>
			{state.comments ? <CommentsPanel notes={state.notes} /> : null}
			<div className="wt-notes-chip">
				<span className="wt-notes-btn" data-open={state.comments || undefined} {...targetProps(state, T.comments)}>
					<HugeiconsIcon icon={Message01Icon} className="size-4 text-[oklch(0.922_0_0)]" strokeWidth={1.5} />
					{`${count} ${count === 1 ? "comment" : "comments"}`}
				</span>
				<span className="wt-notes-btn" {...targetProps(state, T.copyPrompt)}>
					Copy prompt
				</span>
			</div>
		</motion.div>
	);
}

/** The thumbnail is the screen the note was written on, with the target marked. */
const THUMB = { width: 44.1, height: 96 };

function CommentsPanel({ notes }: { notes: TourState["notes"] }) {
	const src = useScreenSrc(SCREENS.cremaDetail);
	return (
		<div className="wt-comments">
			<div className="mb-1 flex items-center justify-between gap-2">
				<span className="text-[13px] font-medium">Comments</span>
				<span className="wt-comments-icon text-white/70">
					<HugeiconsIcon icon={Cancel01Icon} className="size-4" strokeWidth={1.5} />
				</span>
			</div>
			{notes.map((note, index) => (
				<CommentRow key={note.id} src={src} index={index} text={note.text} path={note.path} />
			))}
		</div>
	);
}

function CommentRow({ src, index, text, path }: { src: string | undefined; index: number; text: string; path: string }) {
	const target = AX_ROWS.find((row) => row.path === path)!.frame!;
	return (
			<div className="flex items-start gap-2 py-2">
				<div className="relative shrink-0" style={THUMB}>
					{src ? (
						<img className="block h-full w-full rounded-[8px]" src={src} width={IPHONE_FILE.width} height={IPHONE_FILE.height} alt="" />
					) : null}
					<span
						className="absolute border border-[oklch(0.922_0_0)]"
						style={{
							left: `${(target.x / IPHONE_SCREEN.width) * 100}%`,
							top: `${(target.y / IPHONE_SCREEN.height) * 100}%`,
							width: `${(target.width / IPHONE_SCREEN.width) * 100}%`,
							height: `${(target.height / IPHONE_SCREEN.height) * 100}%`,
						}}
					/>
				</div>
				<div className="min-w-0 flex-1 overflow-hidden" style={{ maxHeight: THUMB.height }}>
					<p className="m-0 text-[13px] leading-[19px]">
						{index + 1}. {text}
					</p>
				</div>
				<div className="flex shrink-0 flex-col gap-1">
					<span className="wt-comments-icon text-red-300">
						<HugeiconsIcon icon={Delete02Icon} className="size-4" strokeWidth={1.5} />
					</span>
					<span className="wt-comments-icon text-white/70">
						<HugeiconsIcon icon={PencilEdit02Icon} className="size-4" strokeWidth={1.5} />
					</span>
				</div>
			</div>
	);
}

function SettingsPanel({ state }: { state: TourState }) {
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-12 shrink-0 items-center gap-2 bg-[#181818] px-3">
				<span className="ml-3 shrink-0 text-[12px] font-medium text-white/62">Settings</span>
				<SelectFace className="min-w-0 flex-1">iPhone 17</SelectFace>
				<div className="flex shrink-0 items-center">
					<span className="grid size-8 place-items-center text-white/42">
						<RotateCcw size={14} strokeWidth={2} />
					</span>
					<span
						className="grid size-8 shrink-0 place-items-center rounded-md text-white/42"
						{...targetProps(state, T.settingsClose)}
					>
						<X size={15} strokeWidth={2} />
					</span>
				</div>
			</div>
			<div className="wt-scroll min-h-0 flex-1 overflow-y-auto">
				<Section>
					<div className="flex min-h-11 items-center gap-2 px-3">
						<div className="flex min-w-0 flex-1 items-center gap-3 py-0.5">
							<div className="grid size-10 shrink-0 place-items-center rounded-[8px] bg-white/[0.06] text-white/70">
								<ProductIcon name="section_apple" size={19} />
							</div>
							<div className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
								<div className="truncate text-[13px] font-semibold leading-4 text-white/92">SpringBoard</div>
								<div className="truncate font-mono text-[11px] leading-[14px] text-white/50">com.apple.springboard</div>
							</div>
						</div>
						<Chevron open={false} />
					</div>
				</Section>
				<Section>
					<SectionTitle icon="section_simulator" label="Simulator" open />
					<div className="flex flex-col gap-1 px-3 pt-1 pb-3">
						{SIMULATOR_SETTINGS.map((setting) => (
							<div
								key={setting.key}
								className="grid min-h-9 min-w-0 grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5"
							>
								<span className="flex size-[18px] items-center justify-center text-white">
									<ProductIcon name={setting.key} size={14} />
								</span>
								<span className="min-w-0 truncate text-[13px] text-white/90">{setting.label}</span>
								<span className="flex min-w-0 justify-end">
									{setting.key === "appearance" ? (
										<AppearanceSelect state={state} />
									) : setting.kind === "select" ? (
										<SelectFace>{setting.value}</SelectFace>
									) : setting.kind === "slider" ? (
										<SliderFace />
									) : (
										<SwitchFace />
									)}
								</span>
							</div>
						))}
					</div>
				</Section>
				{SETTINGS_SECTIONS.map((section) => (
					<Section key={section.key}>
						<SectionTitle icon={`section_${section.key}`} label={section.label} open={false} />
					</Section>
				))}
			</div>
		</div>
	);
}

function Section({ children }: { children: ReactNode }) {
	return (
		<div className="mx-3 mt-2 overflow-hidden rounded-[10px] border border-white/[0.07] bg-white/[0.025] last:mb-3">
			{children}
		</div>
	);
}

function SectionTitle({ icon, label, open }: { icon: ProductIconName; label: string; open: boolean }) {
	return (
		<div className="flex min-h-11 items-center gap-2 px-3 text-white/90">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<ProductIcon name={icon} size={14} className="text-white/45" />
				<span className="text-[12px] font-semibold tracking-[0.08em] text-white/55 uppercase">{label}</span>
			</div>
			<Chevron open={open} />
		</div>
	);
}

function Chevron({ open }: { open: boolean }) {
	return (
		<span className="grid size-8 shrink-0 place-items-center">
			<ChevronDown
				size={15}
				strokeWidth={2.25}
				className="text-white/50"
				style={{ transform: open ? "rotate(180deg)" : undefined }}
			/>
		</span>
	);
}

const SELECT_FACE =
	"flex h-8 min-w-0 max-w-[150px] items-center justify-between gap-2 overflow-hidden rounded-lg bg-[var(--agentsims-button-raised)] px-2.5 text-[13px] leading-4 text-white/90 shadow-[var(--agentsims-button-raised-shadow)]";

function SelectFace({ children, className }: { children: ReactNode; className?: string }) {
	return (
		<span className={`${SELECT_FACE} ${className ?? ""}`}>
			<span className="flex min-w-0 flex-1 items-center truncate whitespace-nowrap text-start leading-4">{children}</span>
			<ChevronDown size={15} strokeWidth={2.25} className="shrink-0 text-white/50" />
		</span>
	);
}

/** Appearance: the one setting with a menu. Dark changes the iPhone 17 Home Screen. */
function AppearanceSelect({ state }: { state: TourState }) {
	return (
		<span className="relative">
			<span
				className={`${SELECT_FACE} wt-select`}
				data-open={state.appearanceMenu || undefined}
				{...targetProps(state, T.appearance)}
			>
				<span className="flex min-w-0 flex-1 items-center truncate whitespace-nowrap text-start leading-4">
					{state.appearance === "dark" ? "Dark" : "Light"}
				</span>
				<ChevronDown
					size={15}
					strokeWidth={2.25}
					className="wt-select-chevron shrink-0 text-white/50"
					data-open={state.appearanceMenu || undefined}
				/>
			</span>
			<AnimatePresence>
				{state.appearanceMenu ? (
					<motion.div
						className="wt-select-popup"
						initial={{ opacity: 0, scale: 0.95 }}
						animate={{ opacity: 1, scale: 1 }}
						exit={{ opacity: 0, scale: 0.95 }}
						transition={{ duration: 0.14, ease: [0, 0, 0.2, 1] }}
					>
						{(["light", "dark"] as const).map((option) => (
							<div
								key={option}
								className="wt-select-item relative flex h-8 w-full items-center rounded-[7px] ps-2.5 pe-8 text-start"
								data-selected={state.appearance === option || undefined}
								{...targetProps(state, T.appearanceOption(option))}
							>
								{option === "light" ? "Light" : "Dark"}
								{state.appearance === option ? (
									<span className="absolute end-2 grid size-4 place-items-center text-[var(--agentsims-accent)]">
										<Check size={14} strokeWidth={2.25} />
									</span>
								) : null}
							</div>
						))}
					</motion.div>
				) : null}
			</AnimatePresence>
		</span>
	);
}

function SliderFace() {
	return (
		<span className="flex w-[120px] min-w-0 flex-col">
			<span className="relative block h-[13px]">
				<span className="absolute inset-x-0 top-[4.5px] h-[4px] rounded-full bg-[linear-gradient(to_right,var(--agentsims-accent)_50%,rgba(255,255,255,0.22)_50%)]" />
				<span className="absolute top-0 left-[calc(50%-6.5px)] size-[13px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.45)]" />
			</span>
			<span className="mt-[3px] flex justify-between px-[5.5px]">
				{Array.from({ length: 7 }, (_, i) => (
					<span key={i} className="size-[2px] rounded-full bg-white/40" />
				))}
			</span>
		</span>
	);
}

function SwitchFace() {
	return (
		<span className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-white/20">
			<span className="ms-0.5 block size-[14px] rounded-full bg-white shadow-[0_1px_2px_oklch(0_0_0/0.35)]" />
		</span>
	);
}
