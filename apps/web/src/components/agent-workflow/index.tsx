import { useEffect, useRef, useState, type ReactNode } from "react";
import { Accessibility as AccessibilityIcon, ChevronDown } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useViewportPlayback } from "../../hooks/use-viewport-playback";

const STEP_DURATION = 3000;

const steps = [
	{
		number: "01",
		title: "Observe the app",
		description:
			"A compact accessibility tree gives the agent exact elements and references. Screenshots provide visual context when needed.",
	},
	{
		number: "02",
		title: "Act precisely",
		description:
			"Tap, type, swipe, scroll, and long-press by element or coordinate across iOS and Android.",
	},
	{
		number: "03",
		title: "Verify the result",
		description:
			"Agentsims waits for the interface to settle and returns fresh state, so the agent can choose the next action.",
	},
] as const;

export function AgentWorkflow() {
	const [playbackRef, inView] = useViewportPlayback<HTMLDivElement>();
	const swipeVideoRef = useRef<HTMLVideoElement>(null);
	const bluetoothVideoRef = useRef<HTMLVideoElement>(null);
	const reducedMotion = useReducedMotion() ?? false;
	const [playbackStep, setPlaybackStep] = useState(0);
	const [observeQuickSettings, setObserveQuickSettings] = useState(false);
	const [pageVisible, setPageVisible] = useState(true);
	const activeStep = playbackStep % steps.length;
	const playing = inView && pageVisible && !reducedMotion;

	useEffect(() => {
		const updateVisibility = () => setPageVisible(!document.hidden);
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		return () =>
			document.removeEventListener("visibilitychange", updateVisibility);
	}, []);

	useEffect(() => {
		if (!playing) return;
		const timer = window.setInterval(
			() => setPlaybackStep((current) => current + 1),
			STEP_DURATION,
		);
		return () => window.clearInterval(timer);
	}, [playing]);

	useEffect(() => {
		const swipeVideo = swipeVideoRef.current;
		const bluetoothVideo = bluetoothVideoRef.current;
		if (!swipeVideo || !bluetoothVideo) return;

		window.clearTimeout(Number(swipeVideo.dataset.timer));
		window.clearTimeout(Number(bluetoothVideo.dataset.timer));

		if (!playing) {
			swipeVideo.pause();
			bluetoothVideo.pause();
			return;
		}

		if (activeStep === 0) {
			setObserveQuickSettings(false);
			swipeVideo.pause();
			swipeVideo.currentTime = 0;
			const timer = window.setTimeout(
				() => swipeVideo.play().catch(() => undefined),
				60,
			);
			swipeVideo.dataset.timer = String(timer);
			return () => window.clearTimeout(timer);
		}

		if (activeStep === 1) {
			bluetoothVideo.pause();
			bluetoothVideo.currentTime = 0;
			const timer = window.setTimeout(
				() => bluetoothVideo.play().catch(() => undefined),
				1750,
			);
			bluetoothVideo.dataset.timer = String(timer);
			return () => window.clearTimeout(timer);
		}
	}, [activeStep, playing]);

	return (
		<section
			className="relative mx-auto max-w-[82rem] overflow-hidden px-[clamp(1.25rem,4vw,4rem)] pt-[clamp(6rem,8vw,8rem)] pb-[clamp(4.5rem,5vw,5rem)]"
			aria-labelledby="agent-workflow-title"
			data-playing={playing}
		>
			<h2
				id="agent-workflow-title"
				className="max-w-[30em] text-[clamp(1.75rem,2.3vw,3rem)] leading-[1.18] font-medium tracking-[-0.04em]"
			>
				<span className="workflow-headline-line">
					<span
						className="workflow-headline-segment"
						data-step="0"
						data-active={reducedMotion || activeStep === 0}
					>
						Agentsims lets agents{" "}
						<span className="workflow-headline-action-wrap">
							<span className="workflow-headline-action">observe</span>
							<sup className="workflow-step-number">01</sup>
						</span>
					</span>
				</span>
				<span className="workflow-headline-line">
					<span
						className="workflow-headline-segment"
						data-step="0"
						data-active={reducedMotion || activeStep === 0}
					>
						the screen,
					</span>{" "}
					<span
						className="workflow-headline-segment"
						data-step="1"
						data-active={reducedMotion || activeStep === 1}
					>
						<span className="workflow-headline-action-wrap">
							<span className="workflow-headline-action">act</span>
							<sup className="workflow-step-number">02</sup>
						</span>{" "}
						on the device,
					</span>
				</span>
				<span className="workflow-headline-line">
					<span
						className="workflow-headline-segment"
						data-step="2"
						data-active={reducedMotion || activeStep === 2}
					>
						and{" "}
						<span className="workflow-headline-action-wrap">
							<span className="workflow-headline-action">verify</span>
							<sup className="workflow-step-number">03</sup>
						</span>{" "}
						every action.
					</span>
				</span>
			</h2>

			<div
				ref={playbackRef}
				className="mt-[clamp(3rem,4vw,4.5rem)] grid grid-cols-3 gap-[clamp(1.5rem,3vw,3.5rem)] max-[62rem]:grid-cols-1 max-[62rem]:gap-16"
			>
				<article
					className="workflow-card"
					data-step="0"
					data-active={reducedMotion || activeStep === 0}
					data-playing={playing && activeStep === 0}
					data-complete={playbackStep > 0 && activeStep !== 0}
				>
					<div className="workflow-stage" aria-hidden="true">
						<div className="workflow-observe-layout">
							<PixelMock className="workflow-phone-observe">
								{reducedMotion ? (
									<img src="/demo/pixel10-home.webp" alt="" />
								) : (
									<video
										ref={swipeVideoRef}
										muted
										playsInline
										preload="metadata"
										poster="/demo/pixel10-home.webp"
										src="/demo/pixel10-swipe-from-top.webm"
										onEnded={() => setObserveQuickSettings(true)}
										onTimeUpdate={(event) => {
											const quickSettings =
												event.currentTarget.currentTime >= 0.9;
											setObserveQuickSettings((current) =>
												current === quickSettings ? current : quickSettings,
											);
										}}
									/>
								)}
								<AccessibilityBounds
									quickSettings={!reducedMotion && observeQuickSettings}
								/>
								<span className="workflow-touch-cursor workflow-swipe-cursor" />
							</PixelMock>
							<AccessibilityPanel
								quickSettings={!reducedMotion && observeQuickSettings}
							/>
						</div>
					</div>
					<StepCopy step={steps[0]} />
				</article>

				<article
					className="workflow-card"
					data-step="1"
					data-active={reducedMotion || activeStep === 1}
					data-playing={playing && activeStep === 1}
					data-complete={playbackStep > 1 && activeStep !== 1}
				>
					<div className="workflow-stage" aria-hidden="true">
						<PixelMock className="workflow-phone-act">
							{reducedMotion ? (
								<img src="/demo/pixel10-quick-settings-off.webp" alt="" />
							) : (
								<video
									ref={bluetoothVideoRef}
									muted
									playsInline
									preload="auto"
									poster="/demo/pixel10-quick-settings-off.webp"
									src="/demo/pixel10-turn-on-bluetooth.webm"
								/>
							)}
							<span className="workflow-touch-cursor workflow-tap-cursor" />
						</PixelMock>
						<div className="workflow-terminal workflow-terminal-window">
							<div className="workflow-terminal-dots">
								<span />
								<span />
								<span />
							</div>
							<div className="workflow-terminal-scroll">
								<div className="workflow-terminal-content workflow-terminal-content-act">
									<p className="workflow-type-line workflow-act-observe-command">
										<span className="workflow-prompt">$</span> agentsims observe
									</p>
									<p className="workflow-response-line workflow-act-result">
										<span className="workflow-kind">└ switch</span>{" "}
										&quot;Bluetooth.&quot;{" "}
										<span className="workflow-reference">[ref=e2004]</span>
									</p>
									<p className="workflow-response-line workflow-act-state pl-4">
										<span className="workflow-muted">[unchecked]</span>{" "}
										<span className="workflow-string">
											[state=&quot;Off&quot;]
										</span>
									</p>
									<div className="workflow-terminal-command-gap" />
									<p className="workflow-type-line workflow-act-tap-command workflow-command-focus">
										<span className="workflow-prompt">$</span> agentsims tap{" "}
										<span className="workflow-reference">@e2004</span>
									</p>
									<p className="workflow-response-line workflow-act-dispatch workflow-success">
										dispatch accepted
									</p>
								</div>
							</div>
						</div>
					</div>
					<StepCopy step={steps[1]} />
				</article>

				<article
					className="workflow-card"
					data-step="2"
					data-active={reducedMotion || activeStep === 2}
					data-playing={playing && activeStep === 2}
					data-complete={playbackStep > 2 && activeStep !== 2}
				>
					<div className="workflow-stage" aria-hidden="true">
						<div className="workflow-screenshot-scene">
							<PixelMock className="workflow-phone-capture">
								<img src="/demo/pixel10-quick-settings-on.webp" alt="" />
							</PixelMock>
							<span className="workflow-screenshot-flash" />
							<div className="workflow-screenshot-preview">
								<img src="/demo/pixel10-quick-settings-on.webp" alt="" />
							</div>
						</div>
					</div>
					<StepCopy step={steps[2]} />
				</article>
			</div>
		</section>
	);
}

function AccessibilityBounds({ quickSettings }: { quickSettings: boolean }) {
	return (
		<div className="workflow-ax-bounds">
			<div className="workflow-ax-box-set" data-visible={!quickSettings}>
				<span className="workflow-ax-box workflow-ax-box-home-glance" />
				<span className="workflow-ax-box workflow-ax-box-home-date" />
				<span className="workflow-ax-box workflow-ax-box-home-play" />
				<span className="workflow-ax-box workflow-ax-box-home-gmail" />
				<span className="workflow-ax-box workflow-ax-box-home-photos" />
				<span className="workflow-ax-box workflow-ax-box-home-youtube" />
				<span className="workflow-ax-box workflow-ax-box-home-phone" />
				<span className="workflow-ax-box workflow-ax-box-home-messages" />
				<span className="workflow-ax-box workflow-ax-box-home-chrome" />
				<span className="workflow-ax-box workflow-ax-box-home-settings" />
				<span className="workflow-ax-box workflow-ax-box-home-search-logo" />
				<span className="workflow-ax-box workflow-ax-box-home-search-field" />
				<span className="workflow-ax-box workflow-ax-box-home-search-mic" />
				<span className="workflow-ax-box workflow-ax-box-home-search-camera" />
			</div>
			<div className="workflow-ax-box-set" data-visible={quickSettings}>
				<span className="workflow-ax-box workflow-ax-box-quick-wifi" />
				<span className="workflow-ax-box workflow-ax-box-quick-bluetooth" />
				<span className="workflow-ax-box workflow-ax-box-quick-mobile" />
				<span className="workflow-ax-box workflow-ax-box-quick-share" />
				<span className="workflow-ax-box workflow-ax-box-quick-empty" />
			</div>
		</div>
	);
}

function AccessibilityPanel({ quickSettings }: { quickSettings: boolean }) {
	return (
		<div className="workflow-ax-panel">
			<div className="workflow-ax-panel-header">
				<span className="workflow-ax-panel-icon">
					<AccessibilityIcon size={14} strokeWidth={1.9} />
				</span>
				<span className="workflow-ax-panel-identity">
					<span className="workflow-ax-panel-status" />
					<span>Pixel 10</span>
				</span>
				<span className="workflow-ax-panel-count">
					{quickSettings ? 89 : 56}
				</span>
			</div>
			<div className="workflow-ax-panel-body">
				<div className="workflow-ax-state" data-visible={!quickSettings}>
					<AxLine
						expanded
						role="scrollview"
						label="At a glance"
						elementRef="e12"
					/>
					<AxLine depth={1} role="text" label="Wed, Sep 16" elementRef="e17" />
					<AxLine role="text" label="Play Store" elementRef="e19" />
					<AxLine role="text" label="Gmail" elementRef="e20" />
					<AxLine role="text" label="Photos" elementRef="e21" />
					<AxLine role="text" label="YouTube" elementRef="e22" />
				</div>
				<div className="workflow-ax-state" data-visible={quickSettings}>
					<AxLine
						expanded
						role="generic"
						label="Notification shade"
						elementRef="e57"
					/>
					<AxLine depth={1} role="generic" label="Wi-Fi" elementRef="e84" />
					<AxLine depth={1} role="generic" label="Bluetooth" elementRef="e95" />
					<AxLine
						depth={1}
						role="generic"
						label="Mobile data"
						elementRef="e105"
					/>
					<AxLine
						depth={1}
						role="generic"
						label="Quick Share"
						elementRef="e117"
					/>
					<AxLine
						depth={1}
						role="text"
						label="You're all caught up"
						elementRef="e68"
					/>
				</div>
			</div>
		</div>
	);
}

function AxLine({
	depth = 0,
	expanded = false,
	role,
	label,
	elementRef,
}: {
	depth?: number;
	expanded?: boolean;
	role: string;
	label: string;
	elementRef: string;
}) {
	return (
		<div className="workflow-ax-line" data-depth={depth}>
			<span className="workflow-ax-toggle">
				{expanded ? <ChevronDown size={13} strokeWidth={1.8} /> : null}
			</span>
			<span className="workflow-ax-role">{role}</span>
			<span className="workflow-ax-label">{label}</span>
			<span className="workflow-ax-ref">@{elementRef}</span>
		</div>
	);
}

function PixelMock({
	className,
	children,
}: {
	className: string;
	children: ReactNode;
}) {
	return (
		<div className={`workflow-phone ${className}`}>
			{children}
			<span className="workflow-phone-camera" />
		</div>
	);
}

function StepCopy({ step }: { step: (typeof steps)[number] }) {
	return (
		<div className="mt-5 grid gap-2.5">
			<p className="font-mono text-xs text-subtle-foreground">{step.number}</p>
			<div className="grid gap-1.5">
				<h3 className="text-[1.0625rem] font-medium tracking-[-0.02em]">
					{step.title}
				</h3>
				<p className="max-w-[34rem] text-[0.9375rem] leading-[1.6] text-pretty text-muted-foreground">
					{step.description}
				</p>
			</div>
		</div>
	);
}
