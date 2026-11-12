import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type CSSProperties,
} from "react";
import { motion, useInView } from "motion/react";
import { AccessibilityPanel, ScreenBoxes, TreeState, type TreeRow } from ".";
import { StepList, useStepSequence, type StepItem } from "../step-list";
import "./skill-steps.css";

/*
 * The loop that the skill teaches: a list of three steps, and one pane. The
 * pane holds one Pixel at a fixed place at its left. Each step puts its
 * companion to the right of the phone: the accessibility panel, the
 * terminal, or the screenshot preview. Only the companions and the screen
 * change between steps.
 */

/** One play of a step, as in the original section. */
const PLAY_MS = 3000;
/** The finished state holds this long before the next step. */
const HOLD_MS = 2000;
/** The outgoing companion leaves (140ms), and 100ms later the incoming one
 * enters (220ms). Then the step plays. */
const ENTER_MS = 460;
/** The screenshot flash, at the time of the original Verify stage. */
const FLASH_AT_MS = 868;
/*
 * The flash and the preview of the product:
 * - hooks/simulator/use-screenshot-preview.ts:24-25: the flash is solid for
 *   75ms, then fades for 210ms.
 * - components/simulator/screenshot-preview.tsx:243-246: the fade is a
 *   0.21s opacity tween.
 * - screenshot-preview.tsx:68, 126-127, 152, 156: the preview is 14px right
 *   of the screen, bottom-aligned with it, one third of its height, with the
 *   aspect ratio of the capture.
 * - screenshot-preview.tsx:347-370 and simulator/presence-motion.ts:2-6: the
 *   preview starts on the screen rect, and after 0.25s moves to its place
 *   with a spring (bounce 0, 0.3s), from its top left corner.
 */
const FLASH_HOLD_MS = 75;
const FLASH_FADE_S = 0.21;
const PREVIEW_DELAY_S = 0.25;
const PREVIEW_MOVE = { type: "spring", bounce: 0, duration: 0.3 } as const;
const PREVIEW_GAP = 14;
/** The capture is the 1080 × 2424 screen of the Pixel. */
const CAPTURE_RATIO = 1080 / 2424;

const items: StepItem[] = [
	{ title: "Observe", text: "Reads the accessibility tree and takes a screenshot." },
	{ title: "Act", text: "Taps, types, or swipes on an element from the tree." },
	{ title: "Verify", text: "Reads the result and the new tree before the next step." },
];

const labels = [
	"Observe: the agent reads the accessibility tree of a Pixel 10. Every element on the screen has an outline.",
	"Act: the agent taps the Bluetooth switch by its reference. The terminal shows dispatch accepted and verification matched.",
	"Verify: the screen flashes, and its screenshot moves beside the phone.",
];

/* The tree rows, short enough for the panel beside the phone. */
const homeRows: TreeRow[] = [
	{ depth: 0, expanded: true, type: "FrameLayout", tone: "structure" },
	{ depth: 1, type: "TextView", props: 'label="Wed, Sep 16"' },
	{ depth: 1, type: "TextView", props: 'label="Play Store"' },
	{ depth: 1, type: "TextView", props: 'label="Gmail"', selected: true },
	{ depth: 1, type: "TextView", props: 'label="Photos"' },
	{ depth: 1, type: "TextView", props: 'label="YouTube"' },
];
const quickSettingsRows: TreeRow[] = [
	{ depth: 0, expanded: true, type: "FrameLayout", tone: "structure" },
	{ depth: 1, type: "Switch", props: 'label="Internet"' },
	{ depth: 1, type: "Switch", props: 'label="Bluetooth"', selected: true },
	{ depth: 1, type: "Switch", props: 'label="Mobile data"' },
	{ depth: 1, type: "Button", props: 'label="Quick Share"' },
	{ depth: 1, type: "TextView", props: 'label="Caught up"' },
];

const PHONE_RATIO = 1080 / 2424;
const PHONE_MAX = 440;
const PHONE_MIN = 360;
const LIST_WIDTH = 320;
const LIST_GAP = 64;
/** A companion starts 16px right of the phone. */
const GAP = 16;
/** The terminal is the widest companion: 32 columns of 13px JetBrains Mono
 * (7.8px each), 12px of padding on each side, and a 1px border. */
const COMPANION_WIDTH = 276;
const PANEL_MAX_WIDTH = 320;
/** The panel is 16.5rem tall, 48px under the top of the screen. */
const PANEL_HEIGHT = 264;
const PANEL_TOP = 48;
/** The terminal text is 13px, so a scale of 11/13 keeps it at 11px. */
const MIN_SCALE = 11 / 13;
/** The list, the pane, and a 360px phone with a companion fit side by side
 * from this width. The same number is in skill-steps.css. */
const SIDE_BY_SIDE_MIN = Math.ceil(
	LIST_WIDTH + LIST_GAP + PHONE_MIN * PHONE_RATIO + GAP + COMPANION_WIDTH,
);

/**
 * The geometry of the pane for a section `width` px wide. Side by side, the
 * pane is the width less the list, and the phone is as tall as fits beside
 * the widest companion, up to 440px. Stacked, the pane is the full width,
 * and on a narrow screen the phone and the companions scale together.
 */
function paneGeometry(width: number) {
	const side = width >= SIDE_BY_SIDE_MIN;
	const pane = side ? width - LIST_WIDTH - LIST_GAP : width;
	const fit = (pane - GAP - COMPANION_WIDTH) / PHONE_RATIO;
	let scale = 1;
	let phoneHeight = Math.min(PHONE_MAX, fit);
	if (!side && fit < PHONE_MIN) {
		scale = Math.max(
			MIN_SCALE,
			pane / (PHONE_MIN * PHONE_RATIO + GAP + COMPANION_WIDTH),
		);
		phoneHeight = (pane / scale - GAP - COMPANION_WIDTH) / PHONE_RATIO;
	}
	const phoneWidth = phoneHeight * PHONE_RATIO;
	const companionLeft = phoneWidth + GAP;
	return {
		scale,
		phone: { left: 0, top: 0, width: phoneWidth, height: phoneHeight },
		companionLeft,
		panelWidth: Math.min(PANEL_MAX_WIDTH, pane / scale - companionLeft),
		// The panel can reach below a short phone.
		height: Math.max(phoneHeight, 1 + PANEL_TOP + PANEL_HEIGHT) * scale,
	};
}

/**
 * The screenshot of Verify, as the product shows it: a white flash over the
 * screen, then the preview over the screen, which moves to its place beside
 * the screen. The phone does not move.
 */
function Screenshot({
	screen,
	playing,
	complete,
}: {
	screen: { left: number; top: number; width: number; height: number };
	playing: boolean;
	complete: boolean;
}) {
	const [phase, setPhase] = useState<"none" | "solid" | "fading">("none");
	useEffect(() => {
		if (!playing) return;
		const timers = [
			window.setTimeout(() => setPhase("solid"), FLASH_AT_MS),
			window.setTimeout(() => setPhase("fading"), FLASH_AT_MS + FLASH_HOLD_MS),
		];
		return () => timers.forEach((timer) => window.clearTimeout(timer));
	}, [playing]);
	const height = screen.height / 3;
	const width = height * CAPTURE_RATIO;
	const rest = {
		left: screen.left + screen.width + PREVIEW_GAP,
		top: screen.top + screen.height - height,
		width,
		height,
	};
	const shown = complete || phase !== "none";
	return (
		<>
			{shown && (
				<motion.div
					className="workflow-screenshot-preview"
					style={{ ...rest, transformOrigin: "top left" }}
					initial={
						complete
							? false
							: {
									x: screen.left - rest.left,
									y: screen.top - rest.top,
									scaleX: screen.width / rest.width,
									scaleY: screen.height / rest.height,
									opacity: 1,
								}
					}
					animate={{ x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 }}
					transition={{ ...PREVIEW_MOVE, delay: PREVIEW_DELAY_S }}
				>
					<div className="workflow-screenshot-image">
						<img
							src="/demo/pixel10-quick-settings-on.webp"
							loading="lazy"
							alt=""
							draggable={false}
						/>
					</div>
				</motion.div>
			)}
			{phase !== "none" && (
				<motion.span
					className="workflow-screen-flash"
					style={screen}
					initial={false}
					animate={{ opacity: phase === "fading" ? 0 : 1 }}
					transition={{ duration: phase === "fading" ? FLASH_FADE_S : 0 }}
				/>
			)}
		</>
	);
}

/**
 * The steps of the skill as a list, with one pane. The phone never moves.
 * Each step plays when its companion is in place, for 3000ms, and holds for
 * 2000ms.
 */
export function SkillSteps() {
	const { ref, running, active, run, playing, select } = useStepSequence({
		count: items.length,
		enterMs: ENTER_MS,
		playMs: PLAY_MS,
		holdMs: HOLD_MS,
	});
	const complete = !running;

	// The step whose play started last. Its companion keeps its played
	// state while it leaves.
	const [played, setPlayed] = useState({ step: -1, run: -1 });
	useEffect(() => {
		if (playing) setPlayed({ step: active, run });
	}, [playing, active, run]);

	// The videos of Observe and Act. A step change shows the first frame;
	// the play starts the video at the original time.
	const observeVideo = useRef<HTMLVideoElement>(null);
	const actVideo = useRef<HTMLVideoElement>(null);
	const [quickSettingsSeen, setQuickSettingsSeen] = useState(false);
	useEffect(() => {
		const video = active === 0 ? observeVideo.current : active === 1 ? actVideo.current : null;
		if (!running) {
			observeVideo.current?.pause();
			actVideo.current?.pause();
			return;
		}
		if (!video) return;
		if (!playing) {
			video.pause();
			video.currentTime = 0;
			if (active === 0) setQuickSettingsSeen(false);
			return;
		}
		video.currentTime = 0;
		const timer = window.setTimeout(
			() => video.play().catch(() => undefined),
			active === 0 ? 60 : 1750,
		);
		return () => window.clearTimeout(timer);
	}, [running, active, playing, run]);
	const quickSettings = running ? quickSettingsSeen : true;

	// The videos load when the steps are half a screen away, not with the page.
	const near = useInView(ref, { once: true, margin: "50% 0px" });
	useEffect(() => {
		if (!near) return;
		for (const video of [observeVideo.current, actVideo.current]) {
			if (!video || video.preload !== "none") continue;
			video.preload = "auto";
			video.load();
		}
	}, [near]);

	const [width, setWidth] = useState(839);
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) return;
		setWidth(root.clientWidth);
		const observer = new ResizeObserver(([entry]) => {
			if (entry) setWidth(entry.contentRect.width);
		});
		observer.observe(root);
		return () => observer.disconnect();
	}, [ref]);
	const layout = paneGeometry(width);
	const { phone, companionLeft } = layout;
	// The screen is the phone less its 1px edge.
	const screen = {
		left: phone.left + 1,
		top: phone.top + 1,
		width: phone.width - 2,
		height: phone.height - 2,
	};
	const actPlayed = running && played.step === 1;
	const verifyPlayed = running && played.step === 2;

	return (
		// The host is a size container, so the CSS and the geometry here use
		// the same width to place the list beside the pane or above it.
		<div ref={ref} className="skill-steps-host">
		<div className="skill-steps">
			<StepList items={items} active={active} onSelect={select} />
			<div
				role="img"
				aria-label={labels[active]}
				className="skill-steps-pane product-ui"
				style={{ height: layout.height }}
			>
				<div
					className="workflow-stage"
					aria-hidden="true"
					inert
					style={layout.scale === 1 ? undefined : { transform: `scale(${layout.scale})` }}
				>
					<div
						className="workflow-phone"
						data-playing={playing}
						style={
							{
								left: phone.left,
								top: phone.top,
								width: phone.width,
								height: phone.height,
								"--phone-height": `${phone.height}px`,
							} as CSSProperties
						}
					>
						<video
							ref={observeVideo}
							className="workflow-screen"
							data-visible={running && active === 0}
							muted
							playsInline
							preload="none"
							draggable={false}
							poster="/demo/pixel10-home.webp"
							src="/demo/pixel10-swipe-from-top.webm"
							onEnded={() => setQuickSettingsSeen(true)}
							onTimeUpdate={(event) => {
								const next = event.currentTarget.currentTime >= 0.9;
								setQuickSettingsSeen((current) => (current === next ? current : next));
							}}
						/>
						<img
							className="workflow-screen"
							data-visible={!running && active === 0}
							src="/demo/pixel10-quick-settings-off.webp"
							loading="lazy"
							alt=""
							draggable={false}
						/>
						<video
							ref={actVideo}
							className="workflow-screen"
							data-visible={running && active === 1}
							muted
							playsInline
							preload="none"
							draggable={false}
							poster="/demo/pixel10-quick-settings-off.webp"
							src="/demo/pixel10-turn-on-bluetooth.webm"
						/>
						<img
							className="workflow-screen"
							data-visible={active === 2 || (!running && active === 1)}
							src="/demo/pixel10-quick-settings-on.webp"
							loading="lazy"
							alt=""
							draggable={false}
						/>
						<div className="workflow-boxes step-fade" data-shown={active === 0}>
							<ScreenBoxes screen="home" visible={!quickSettings} />
							<ScreenBoxes screen="quick" visible={quickSettings} />
						</div>
						{active === 0 && (
							<span key={`swipe-${run}`} className="workflow-touch-cursor workflow-swipe-cursor" />
						)}
						{active === 1 && (
							<span key={`tap-${run}`} className="workflow-touch-cursor workflow-tap-cursor" />
						)}
						<span className="workflow-phone-camera" />
					</div>

					<div className="workflow-companion step-fade" data-shown={active === 0}>
						<div
							className="workflow-ax-slot"
							style={{
								left: companionLeft,
								top: screen.top + PANEL_TOP,
								width: layout.panelWidth,
								height: PANEL_HEIGHT,
							}}
						>
							<AccessibilityPanel count={quickSettings ? 89 : 56}>
								<TreeState rows={homeRows} visible={!quickSettings} />
								<TreeState rows={quickSettingsRows} visible={quickSettings} />
							</AccessibilityPanel>
						</div>
					</div>

					<div
						className="workflow-companion step-fade"
						data-shown={active === 1}
						data-playing={actPlayed}
						data-complete={complete}
					>
						<div
							className="workflow-terminal"
							style={{
								left: companionLeft,
								top: phone.top + phone.height / 2,
								translate: "0 -50%",
							}}
						>
							<div className="workflow-terminal-dots">
								<span />
								<span />
								<span />
							</div>
							{/* The output of a tap, in the formats of `renderActionResult`. */}
							<div key={actPlayed ? played.run : "still"} className="workflow-terminal-content">
								<p className="workflow-type-line workflow-act-tap-command workflow-command-focus">
									<span className="workflow-prompt">$</span> agentsims tap{" "}
									<span className="workflow-reference">@e2004</span>
								</p>
								<div className="workflow-terminal-command-gap" />
								<p className="workflow-response-line workflow-act-dispatch">
									<span className="workflow-muted">dispatch</span>
									{"  "}
									<span className="workflow-success">accepted</span>
								</p>
								<p className="workflow-response-line workflow-act-dispatch">
									<span className="workflow-muted">verification</span>
									{"  "}
									<span className="workflow-success">matched</span>
								</p>
								<p className="workflow-response-line workflow-act-dispatch">
									<span className="workflow-muted">checked:</span>{" "}
									<span className="workflow-string">unchecked → checked</span>
								</p>
								<p className="workflow-response-line workflow-act-dispatch">
									<span className="workflow-kind">- switch</span> &quot;Bluetooth&quot;{" "}
									<span className="workflow-reference">[ref=e2004]</span>
								</p>
								<p className="workflow-response-line workflow-act-dispatch">
									{"  "}
									<span className="workflow-muted">[checked]</span>
								</p>
							</div>
						</div>
					</div>

					<div className="workflow-companion step-fade" data-shown={active === 2}>
						<Screenshot
							key={verifyPlayed ? played.run : "still"}
							screen={screen}
							playing={verifyPlayed}
							complete={complete}
						/>
					</div>
				</div>
			</div>
		</div>
		</div>
	);
}
