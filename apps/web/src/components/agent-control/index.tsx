import { Asterisk02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@agentsims/ui/lib/utils";
import { StreamingText } from "@agentsims/ui/motion/streaming-text";
import {
	AnimatePresence,
	MotionConfig,
	motion,
	useReducedMotion,
	type Variants,
} from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useViewportPlayback } from "../../hooks/use-viewport-playback";
import { IPhoneMock } from "../product-demo/phones";
import "./styles.css";

const DEMO_DURATION = 30.02;
const TYPE_INTERVAL_MS = 24;
const INITIAL_PROMPT_HOLD_MS = 220;
const USER_PROMPT = "Put the iPhone in dark mode.";
const LIQUID_GLASS_PROMPT = "Make the Home Screen icons Liquid Glass.";
const TINTED_PROMPT = "Nah, I don’t like this. Make them Tinted instead.";
const PROMPT_SEND_DELAY =
	USER_PROMPT.length * TYPE_INTERVAL_MS + INITIAL_PROMPT_HOLD_MS;

const followupPrompts = [
	{ at: 4.48, duration: 0.65, text: LIQUID_GLASS_PROMPT },
	{ at: 15.23, duration: 0.8, text: TINTED_PROMPT },
] as const;

const terminalLineReveal = {
	hidden: { opacity: 0, y: 3, filter: "blur(1px)" },
	shown: {
		opacity: 1,
		y: 0,
		filter: "blur(0px)",
		transition: { duration: 0.14, ease: [0.22, 1, 0.36, 1] },
	},
	hiding: {
		opacity: 0,
		transition: { duration: 0.08, ease: "easeOut" },
	},
} satisfies Variants;

const terminalToolReveal = {
	hidden: { opacity: 0 },
	shown: {
		opacity: 1,
		transition: { duration: 0.12, ease: "easeOut" },
	},
	hiding: {
		opacity: 0,
		transition: { duration: 0.08, ease: "easeOut" },
	},
} satisfies Variants;

type TranscriptLine = {
	at: number;
	kind:
		| "user"
		| "message"
		| "skill"
		| "command"
		| "result"
		| "cooked"
		| "complete";
	text: string;
};

const transcriptHoldMs = {
	user: 350,
	message: 650,
	skill: 350,
	command: 250,
	result: 0,
	cooked: 600,
	complete: 850,
} satisfies Record<TranscriptLine["kind"], number>;

const activityTimeline = [
	{ at: 0, label: "Simmering", active: true },
	{ at: 4.15, label: "", active: false },
	{ at: 5.13, label: "Glassmaking", active: true },
	{ at: 14.95, label: "", active: false },
	{ at: 16.03, label: "Simming", active: true },
	{ at: 29.25, label: "", active: false },
] as const;

const transcript: readonly TranscriptLine[] = [
	{
		at: 0.25,
		kind: "message",
		text: "I’ll use the mobile workflow and switch iPhone 17 to dark mode.",
	},
	{ at: 0.7, kind: "skill", text: "build-mobile-apps" },
	{ at: 1.35, kind: "result", text: "Successfully loaded skill" },
	{
		at: 2.2,
		kind: "command",
		text: 'xcrun simctl ui "iPhone 17" appearance dark',
	},
	{ at: 2.75, kind: "result", text: "Appearance changed to dark" },
	{
		at: 2.95,
		kind: "command",
		text: 'agentsims observe -d "iPhone 17"',
	},
	{ at: 3.45, kind: "result", text: "Home Screen · dark appearance" },
	{
		at: 3.65,
		kind: "message",
		text: "Changed iPhone 17 to dark mode.",
	},
	{ at: 4.15, kind: "cooked", text: "Cooked for 4s" },
	{
		at: 5.13,
		kind: "user",
		text: LIQUID_GLASS_PROMPT,
	},
	{
		at: 5.38,
		kind: "message",
		text: "I’ll use Clear.",
	},
	{
		at: 5.65,
		kind: "command",
		text: 'agentsims observe -d "iPhone 17"',
	},
	{ at: 5.95, kind: "result", text: "Home Screen ready" },
	{
		at: 6.15,
		kind: "command",
		text: 'agentsims long-press "50%,70%" -d "iPhone 17" --duration 700',
	},
	{ at: 7.32, kind: "result", text: "Entered Home Screen edit mode" },
	{
		at: 7.35,
		kind: "command",
		text: 'agentsims tap "Edit" -d "iPhone 17"',
	},
	{ at: 8.35, kind: "result", text: "Opened the appearance menu" },
	{
		at: 8.9,
		kind: "command",
		text: 'agentsims tap "Customise" -d "iPhone 17"',
	},
	{ at: 10.6, kind: "result", text: "Opened Customise" },
	{
		at: 10.8,
		kind: "command",
		text: 'agentsims tap "Clear" -d "iPhone 17"',
	},
	{ at: 11.9, kind: "result", text: "Selected Clear" },
	{
		at: 13.1,
		kind: "command",
		text: 'agentsims tap "50%,45%" -d "iPhone 17"',
	},
	{ at: 14.22, kind: "result", text: "Closed Customise" },
	{
		at: 14.3,
		kind: "message",
		text: "Changed the Home Screen icons to Clear.",
	},
	{ at: 14.95, kind: "cooked", text: "Cooked for 10s" },
	{
		at: 16.03,
		kind: "user",
		text: TINTED_PROMPT,
	},
	{
		at: 16.28,
		kind: "message",
		text: "I’ll switch the icons from Clear to Tinted.",
	},
	{
		at: 16.6,
		kind: "command",
		text: 'agentsims observe -d "iPhone 17"',
	},
	{ at: 16.95, kind: "result", text: "Home Screen ready" },
	{
		at: 17.35,
		kind: "command",
		text: 'agentsims long-press "50%,70%" -d "iPhone 17" --duration 700',
	},
	{ at: 18.9, kind: "result", text: "Entered Home Screen edit mode" },
	{
		at: 19.1,
		kind: "command",
		text: 'agentsims tap "Edit" -d "iPhone 17"',
	},
	{ at: 20.5, kind: "result", text: "Opened the appearance menu" },
	{
		at: 21.3,
		kind: "command",
		text: 'agentsims tap "Customise" -d "iPhone 17"',
	},
	{ at: 22.4, kind: "result", text: "Opened Customise" },
	{
		at: 22.65,
		kind: "command",
		text: 'agentsims tap "Tinted" -d "iPhone 17"',
	},
	{ at: 24, kind: "result", text: "Selected Tinted" },
	{
		at: 26.8,
		kind: "command",
		text: 'agentsims tap "50%,45%" -d "iPhone 17"',
	},
	{ at: 27.98, kind: "result", text: "Closed Customise" },
	{
		at: 28.2,
		kind: "complete",
		text: "Done. iPhone 17 is in dark mode with Tinted Home Screen icons.",
	},
	{ at: 29.25, kind: "cooked", text: "Cooked for 13s" },
];

const touchEvents = [
	{ kind: "long-press", at: 6.22, x: 50, y: 70 },
	{ kind: "tap", at: 7.4, x: 10, y: 3.5 },
	{ kind: "tap", at: 9.15, x: 43, y: 11 },
	{ kind: "tap", at: 10.85, x: 66, y: 84 },
	{ kind: "tap", at: 13.3, x: 50, y: 45 },
	{ kind: "long-press", at: 17.8, x: 50, y: 70 },
	{ kind: "tap", at: 19.45, x: 10, y: 3.5 },
	{ kind: "tap", at: 21.4, x: 43, y: 11 },
	{ kind: "tap", at: 23.05, x: 89, y: 84 },
	{ kind: "tap", at: 27.05, x: 50, y: 45 },
] as const;

function lineCountAt(time: number) {
	let count = 0;
	for (const line of transcript) {
		if (line.at > time) break;
		count += 1;
	}
	return count;
}

function activityIndexAt(time: number) {
	let index = 0;
	for (const [nextIndex, activity] of activityTimeline.entries()) {
		if (activity.at > time) break;
		index = nextIndex;
	}
	return index;
}

function touchCountAt(time: number) {
	let count = 0;
	for (const event of touchEvents) {
		if (event.at > time) break;
		count += 1;
	}
	return count;
}

function nextTimelineTime(time: number) {
	let nextTime = Number.POSITIVE_INFINITY;
	for (const line of transcript) {
		if (line.at > time) {
			nextTime = line.at;
			break;
		}
	}
	for (const activity of activityTimeline) {
		if (activity.at > time) {
			nextTime = Math.min(nextTime, activity.at);
			break;
		}
	}
	for (const event of touchEvents) {
		if (event.at > time) {
			nextTime = Math.min(nextTime, event.at);
			break;
		}
	}
	return nextTime;
}

function ClaudeHeader() {
	return (
		<header className="agent-terminal-header">
			<img
				className="size-16 shrink-0"
				src="/demo/claude-code.svg"
				loading="lazy"
				decoding="async"
				alt=""
			/>
			<div className="min-w-0">
				<p className="m-0 text-[oklch(1_0_0/0.92)]">
					<span className="font-medium">Claude Code</span>{" "}
					<span className="text-[oklch(1_0_0/0.36)]">v2.1.272</span>
				</p>
				<p className="m-0 truncate text-[oklch(1_0_0/0.44)]">
					Opus 5 (1M context) with high effort · Claude Team
				</p>
				<p className="m-0 text-[oklch(1_0_0/0.35)]">~/code/agentsims</p>
			</div>
		</header>
	);
}

function TranscriptEntry({ line }: { line: TranscriptLine }) {
	const command = line.kind === "command";
	const agentsimsCommand = command
		? line.text.match(/^agentsims\s+\S+/)?.[0]
		: undefined;
	const skill = line.kind === "skill";
	const result = line.kind === "result";
	const cooked = line.kind === "cooked";
	if (line.kind === "user") {
		return (
			<motion.div
				variants={terminalLineReveal}
				initial="hidden"
				animate="shown"
				exit="hiding"
				className="agent-terminal-prompt agent-terminal-followup-prompt"
			>
				<span className="text-[oklch(1_0_0/0.44)]" aria-hidden="true">
					&gt;
				</span>
				<span>{line.text}</span>
			</motion.div>
		);
	}
	return (
		<motion.div
			variants={
				command || skill || result || cooked
					? terminalToolReveal
					: terminalLineReveal
			}
			initial="hidden"
			animate="shown"
			exit="hiding"
			className={cn(
				"agent-terminal-row",
				result && "text-[oklch(1_0_0/0.32)]",
				cooked && "text-[oklch(1_0_0/0.35)]",
				line.kind === "message" && "text-[oklch(1_0_0/0.82)]",
				(command || skill) && "text-[oklch(1_0_0/0.52)]",
				line.kind === "complete" && "text-[oklch(1_0_0/0.82)]",
			)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"agent-terminal-marker",
					skill && "text-[oklch(0.72_0.18_150)]",
				)}
			>
				{cooked ? (
					<HugeiconsIcon
						icon={Asterisk02Icon}
						strokeWidth={1.8}
						className="agent-terminal-cooked-icon"
					/>
				) : result ? (
					<span className="agent-terminal-result-mark">⎿</span>
				) : (
					<span className="agent-terminal-dot" />
				)}
			</span>
			<span className="min-w-0 overflow-hidden whitespace-nowrap">
				{skill ? (
					<>
						<strong className="font-semibold text-[oklch(1_0_0/0.92)]">
							Skill
						</strong>
						<span className="text-[oklch(1_0_0/0.92)]">({line.text})</span>
					</>
				) : command ? (
					<>
						<span className="text-[oklch(1_0_0/0.36)]">Bash(</span>
						{agentsimsCommand ? (
							<>
								<strong className="font-semibold text-[oklch(1_0_0/0.92)]">
									{agentsimsCommand}
								</strong>
								{line.text.slice(agentsimsCommand.length)}
							</>
						) : (
							line.text
						)}
						<span className="text-[oklch(1_0_0/0.36)]">)</span>
					</>
				) : line.kind === "message" || line.kind === "complete" ? (
					<StreamingText>{line.text}</StreamingText>
				) : (
					line.text
				)}
			</span>
		</motion.div>
	);
}

function WorkflowPhone({
	videoRef,
	playing,
	playbackCycle,
	reducedMotion,
	manualPlaying,
	visibleTouchCount,
	onPlaybackChange,
	onTogglePlayback,
	onTimeUpdate,
	onEnded,
	onCanPlay,
}: {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	playing: boolean;
	playbackCycle: number;
	reducedMotion: boolean;
	manualPlaying: boolean;
	visibleTouchCount: number;
	onPlaybackChange: (playing: boolean) => void;
	onTogglePlayback: () => void;
	onTimeUpdate: () => void;
	onEnded: () => void;
	onCanPlay: () => void;
}) {
	return (
		<IPhoneMock
			className="agent-workflow-phone !absolute"
			labelScale="var(--agent-workflow-label-scale)"
			data-playing={playing}
		>
			<video
				ref={videoRef}
				className="absolute top-[1.872%] left-[5.727%] z-[3] h-[96.256%] w-[88.546%] rounded-[15.174%/6.979%] bg-linear-[155deg,oklch(0.224584_0.026372_258.317),oklch(0.189824_0.027443_258.29)_52%,oklch(0.157319_0.017155_256.284)] object-cover outline outline-1 -outline-offset-1 outline-[oklch(1_0_0/0.1)]"
				muted
				playsInline
				preload="none"
				poster="/demo/iphone-dark-mode-poster.jpg"
				onTimeUpdate={onTimeUpdate}
				onEnded={onEnded}
				onCanPlay={onCanPlay}
				onPlaying={() => onPlaybackChange(true)}
				onPause={() => onPlaybackChange(false)}
				onWaiting={() => onPlaybackChange(false)}
				aria-label="iPhone 17 Home Screen customization demo"
			>
				<source src="/demo/iphonedarkmode.webm?v=1" type="video/webm" />
			</video>
			<div key={playbackCycle} className="agent-touch-layer" aria-hidden="true">
				{touchEvents.slice(0, visibleTouchCount).map((event) => (
					<span
						key={`${event.kind}-${event.at}`}
						className={cn(
							"agent-touch-cursor",
							event.kind === "long-press"
								? "agent-touch-long-press"
								: "agent-touch-tap",
						)}
						style={{
							top: `${event.y}%`,
							insetInlineStart: `${event.x}%`,
						}}
					/>
				))}
			</div>
			{reducedMotion && (
				<button
					type="button"
					className="absolute top-[calc(100%+0.75rem)] left-1/2 min-h-11 -translate-x-1/2 rounded-full border border-[oklch(1_0_0/0.12)] bg-[oklch(1_0_0/0.08)] px-4 text-xs font-medium whitespace-nowrap text-[oklch(1_0_0/0.76)] transition-[background-color,color] duration-150 ease-out hover:bg-[oklch(1_0_0/0.12)] hover:text-[oklch(1_0_0)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[oklch(1_0_0/0.6)]"
					onClick={onTogglePlayback}
				>
					{manualPlaying ? "Pause demo" : "Play demo"}
				</button>
			)}
		</IPhoneMock>
	);
}

export function AgentControlSection() {
	const [stageRef, inView] = useViewportPlayback<HTMLDivElement>();
	const videoRef = useRef<HTMLVideoElement>(null);
	const transcriptRef = useRef<HTMLDivElement>(null);
	const replayTimerRef = useRef<number | null>(null);
	const holdTimerRef = useRef<number | null>(null);
	const nextHoldIndexRef = useRef(0);
	const holdingRef = useRef(false);
	const reducedMotion = useReducedMotion() ?? false;
	const [pageVisible, setPageVisible] = useState(true);
	const [visibleLineCount, setVisibleLineCount] = useState(
		reducedMotion ? transcript.length : 0,
	);
	const [activityIndex, setActivityIndex] = useState(
		reducedMotion ? activityTimeline.length - 1 : 0,
	);
	const [visibleTouchCount, setVisibleTouchCount] = useState(0);
	const [manualPlaying, setManualPlaying] = useState(false);
	const [videoPlaying, setVideoPlaying] = useState(false);
	const [playbackCycle, setPlaybackCycle] = useState(0);
	const [promptSent, setPromptSent] = useState(reducedMotion);
	const [transcriptScrolled, setTranscriptScrolled] = useState(false);

	const startPlayback = useCallback(() => {
		if (
			reducedMotion ||
			!inView ||
			!pageVisible ||
			!promptSent ||
			holdingRef.current
		)
			return;
		const video = videoRef.current;
		if (!video || !video.paused || video.ended) return;
		void video.play().catch(() => undefined);
	}, [inView, pageVisible, promptSent, reducedMotion]);

	useEffect(() => {
		const updateVisibility = () => setPageVisible(!document.hidden);
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		return () =>
			document.removeEventListener("visibilitychange", updateVisibility);
	}, []);

	useEffect(
		() => () => {
			if (replayTimerRef.current !== null) {
				window.clearTimeout(replayTimerRef.current);
			}
			if (holdTimerRef.current !== null) {
				window.clearTimeout(holdTimerRef.current);
			}
		},
		[],
	);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || reducedMotion) return;

		let idleHandle: number | null = null;
		let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
		const preloadVideo = () => {
			if (!video.paused || video.currentTime > 0) return;
			video.preload = "auto";
			video.load();
		};
		const schedulePreload = () => {
			if ("requestIdleCallback" in window) {
				idleHandle = window.requestIdleCallback(preloadVideo, {
					timeout: 2000,
				});
				return;
			}
			fallbackTimer = globalThis.setTimeout(preloadVideo, 250);
		};

		if (document.readyState === "complete") schedulePreload();
		else window.addEventListener("load", schedulePreload, { once: true });

		return () => {
			window.removeEventListener("load", schedulePreload);
			if (idleHandle !== null) window.cancelIdleCallback(idleHandle);
			if (fallbackTimer !== null) globalThis.clearTimeout(fallbackTimer);
		};
	}, [reducedMotion]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		if (reducedMotion) {
			video.pause();
			setManualPlaying(false);
			setVideoPlaying(false);
			setPromptSent(true);
			setVisibleLineCount(transcript.length);
			setActivityIndex(activityTimeline.length - 1);
			setVisibleTouchCount(0);
			return;
		}
		if (!inView || !pageVisible) {
			video.pause();
			return;
		}
		if (!promptSent) {
			const timer = window.setTimeout(
				() => setPromptSent(true),
				PROMPT_SEND_DELAY,
			);
			return () => window.clearTimeout(timer);
		}
		if (video.ended) {
			nextHoldIndexRef.current = 0;
			holdingRef.current = false;
			video.currentTime = 0;
			setVisibleLineCount(0);
			setActivityIndex(0);
			setVisibleTouchCount(0);
			setPlaybackCycle((cycle) => cycle + 1);
			setPromptSent(false);
			return;
		}
		startPlayback();
	}, [inView, pageVisible, promptSent, reducedMotion, startPlayback]);

	useEffect(() => {
		const transcriptElement = transcriptRef.current;
		if (!transcriptElement) return;
		const frame = window.requestAnimationFrame(() => {
			const overflow =
				transcriptElement.scrollHeight - transcriptElement.clientHeight;
			if (overflow <= 0) {
				transcriptElement.scrollTop = 0;
				setTranscriptScrolled(false);
				return;
			}
			transcriptElement.scrollTo({
				top: overflow,
				behavior: reducedMotion ? "auto" : "smooth",
			});
			setTranscriptScrolled(true);
		});
		return () => window.cancelAnimationFrame(frame);
	}, [reducedMotion, visibleLineCount]);

	const updateTranscript = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		const nextCount = lineCountAt(video.currentTime);
		const nextActivityIndex = activityIndexAt(video.currentTime);
		const nextTouchCount = touchCountAt(video.currentTime);
		setVisibleLineCount((current) =>
			current === nextCount ? current : nextCount,
		);
		setActivityIndex((current) =>
			current === nextActivityIndex ? current : nextActivityIndex,
		);
		setVisibleTouchCount((current) =>
			current === nextTouchCount ? current : nextTouchCount,
		);

		const line = transcript[nextHoldIndexRef.current];
		if (!line || video.currentTime < line.at || holdingRef.current) return;

		nextHoldIndexRef.current += 1;
		const holdDuration = transcriptHoldMs[line.kind];
		if (holdDuration === 0) return;
		holdingRef.current = true;
		video.pause();
		holdTimerRef.current = window.setTimeout(() => {
			holdTimerRef.current = null;
			holdingRef.current = false;
			if (!inView || !pageVisible || video.ended) return;
			void video.play().catch(() => undefined);
		}, holdDuration);
	}, [inView, pageVisible]);

	useEffect(() => {
		const video = videoRef.current;
		if (!video || !videoPlaying || reducedMotion) return;

		let timer: number | null = null;
		const scheduleNextUpdate = () => {
			updateTranscript();
			const nextTime = nextTimelineTime(video.currentTime);
			if (!Number.isFinite(nextTime)) return;
			const delay = Math.max(4, (nextTime - video.currentTime) * 1000 + 4);
			timer = window.setTimeout(scheduleNextUpdate, delay);
		};
		scheduleNextUpdate();

		return () => {
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [playbackCycle, reducedMotion, updateTranscript, videoPlaying]);

	const toggleReducedPlayback = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		if (!video.paused) {
			video.pause();
			setManualPlaying(false);
			return;
		}
		if (video.ended || video.currentTime >= DEMO_DURATION - 0.25) {
			video.currentTime = 0;
			setVisibleLineCount(0);
			setActivityIndex(0);
			setVisibleTouchCount(0);
			setPlaybackCycle((cycle) => cycle + 1);
		}
		void video.play().then(() => setManualPlaying(true));
	}, []);

	const handleVideoEnded = useCallback(() => {
		setManualPlaying(false);
		setVideoPlaying(false);
		setVisibleLineCount(transcript.length);
		setActivityIndex(activityTimeline.length - 1);
		setVisibleTouchCount(touchEvents.length);
		if (reducedMotion) return;
		if (replayTimerRef.current !== null) {
			window.clearTimeout(replayTimerRef.current);
		}
		replayTimerRef.current = window.setTimeout(() => {
			replayTimerRef.current = null;
			const video = videoRef.current;
			if (!video || !inView || !pageVisible) return;
			nextHoldIndexRef.current = 0;
			holdingRef.current = false;
			video.currentTime = 0;
			setVisibleLineCount(0);
			setActivityIndex(0);
			setVisibleTouchCount(0);
			setPlaybackCycle((cycle) => cycle + 1);
			setPromptSent(false);
		}, 1600);
	}, [inView, pageVisible, reducedMotion]);

	const activity = activityTimeline[activityIndex] ?? activityTimeline[0];

	return (
		<section
			className="agent-workflow-section relative mx-auto max-w-[82rem] overflow-hidden px-[clamp(1.25rem,4vw,4rem)] pt-[clamp(4.5rem,5vw,5rem)] pb-[clamp(6rem,8vw,8rem)]"
			aria-labelledby="agent-control-title"
		>
			<div className="relative grid grid-cols-[minmax(18rem,0.72fr)_minmax(36rem,1.4fr)] items-start gap-[clamp(3rem,5vw,5rem)] max-[64rem]:grid-cols-1">
				<div className="max-w-[34rem] pt-8 max-[64rem]:max-w-2xl max-[64rem]:pt-0">
					<h2
						id="agent-control-title"
						className="m-0 text-[clamp(2rem,2.6vw,2.5rem)] leading-[1.1] font-medium tracking-[-0.04em] text-balance"
					>
						Use it yourself or hand it to an agent.
					</h2>
					<p className="mt-6 mb-0 max-w-[31rem] text-base leading-6 text-muted-foreground">
						Developers get every running iOS simulator and Android device in one
						browser, with screenshots, recordings, settings, and accessibility
						inspection.
					</p>
					<p className="mt-4 mb-0 max-w-[31rem] text-base leading-6 text-muted-foreground">
						Give the CLI and skill to any coding agent. It can inspect, control,
						and verify your app through the same workspace, with React Native
						source context and a trace of every action.
					</p>
				</div>

				<MotionConfig reducedMotion="user">
					<div
						ref={stageRef}
						className="agent-workflow-stage"
						data-playing={videoPlaying}
					>
						<div className="agent-workflow-terminal-frame">
							<div className="agent-workflow-terminal">
								<ClaudeHeader />
								<div
									ref={transcriptRef}
									className="agent-terminal-scroll"
									data-scrolled={transcriptScrolled}
									onScroll={(event) =>
										setTranscriptScrolled(event.currentTarget.scrollTop > 1)
									}
								>
									{promptSent && (
										<motion.div
											className="agent-terminal-prompt"
											variants={terminalLineReveal}
											initial="hidden"
											animate="shown"
										>
											<span
												className="text-[oklch(1_0_0/0.44)]"
												aria-hidden="true"
											>
												&gt;
											</span>
											<span>{USER_PROMPT}</span>
										</motion.div>
									)}

									{promptSent && (
										<div className="agent-workflow-transcript">
											<div className="agent-terminal-output">
												<AnimatePresence initial={false}>
													{transcript.slice(0, visibleLineCount).map((line) => (
														<TranscriptEntry
															key={`${line.at}-${line.text}`}
															line={line}
														/>
													))}
												</AnimatePresence>
											</div>
										</div>
									)}
								</div>

								<div
									className="agent-terminal-activity"
									data-active={activity.active}
									role="status"
								>
									{promptSent && activity.active && (
										<>
											<HugeiconsIcon
												icon={Asterisk02Icon}
												strokeWidth={1.8}
												className="agent-terminal-activity-icon"
											/>
											<AnimatePresence mode="wait" initial={false}>
												<motion.span
													key={activity.label}
													initial={{ opacity: 0 }}
													animate={{ opacity: 1 }}
													exit={{ opacity: 0 }}
													transition={{ duration: 0.15, ease: "easeOut" }}
													className="shimmer shimmer-duration-1800 shimmer-spread-8"
												>
													{activity.label}
												</motion.span>
											</AnimatePresence>
										</>
									)}
								</div>

								<div className="agent-terminal-composer">
									<div className="agent-terminal-input">
										<span>&gt;</span>
										{!promptSent && (
											<span
												className="agent-terminal-typing-prompt agent-terminal-initial-typing"
												data-typing={inView}
												style={
													{
														"--typing-width": `${USER_PROMPT.length}ch`,
														animationDuration: `${USER_PROMPT.length * TYPE_INTERVAL_MS}ms`,
														animationTimingFunction: `steps(${USER_PROMPT.length}, end)`,
													} as React.CSSProperties
												}
											>
												{USER_PROMPT}
											</span>
										)}
										{promptSent &&
											followupPrompts.map((prompt) => (
												<span
													key={`${playbackCycle}-${prompt.at}`}
													className="agent-terminal-typing-prompt agent-terminal-followup-typing"
													style={
														{
															"--typing-width": `${prompt.text.length}ch`,
															animationDelay: `${prompt.at}s`,
															animationDuration: `${prompt.duration}s`,
															animationTimingFunction: `steps(${prompt.text.length}, end)`,
														} as React.CSSProperties
													}
												>
													{prompt.text}
												</span>
											))}
										<span className="agent-terminal-cursor" />
									</div>
									<div className="agent-terminal-footer">
										<span aria-hidden="true">▶▶</span>
										<span>Bypass permissions on</span>
										<span aria-hidden="true">·</span>
										<span>Agentsims connected</span>
									</div>
								</div>
							</div>
							<div className="agent-terminal-vignette-right" />
							<div className="agent-terminal-vignette-bottom" />
						</div>

						<WorkflowPhone
							videoRef={videoRef}
							playing={videoPlaying}
							playbackCycle={playbackCycle}
							reducedMotion={reducedMotion}
							manualPlaying={manualPlaying}
							visibleTouchCount={visibleTouchCount}
							onPlaybackChange={setVideoPlaying}
							onTogglePlayback={toggleReducedPlayback}
							onTimeUpdate={updateTranscript}
							onEnded={handleVideoEnded}
							onCanPlay={startPlayback}
						/>
					</div>
				</MotionConfig>
			</div>
			<p className="sr-only">
				Demo: the user asks Claude Code to put iPhone 17 in dark mode, use
				Liquid Glass icons, then replace them with Tinted icons.
			</p>
		</section>
	);
}
