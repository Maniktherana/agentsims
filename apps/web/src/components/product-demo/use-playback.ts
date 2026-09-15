import { useEffect, useRef, useState, type RefObject } from "react";
import { useInView, useReducedMotion } from "motion/react";
import {
	STORYBOARD,
	REDUCED_MOTION_FRAME,
	type DemoPlayback,
	type DemoFrame,
} from "./storyboard";

export function useDemoPlayback(sceneRef: RefObject<HTMLDivElement | null>) {
	const inView = useInView(sceneRef, { amount: 0.5 });
	const reducedMotion = useReducedMotion();
	const [playback, setPlayback] = useState<DemoPlayback>({
		phase: "boot",
		step: 0,
	});
	const [paused, setPaused] = useState(false);
	const [pageVisible, setPageVisible] = useState(true);
	const frame = reducedMotion
		? REDUCED_MOTION_FRAME
		: STORYBOARD[playback.phase][playback.step]!;
	const clock = useRef<{ frame: DemoFrame | null; remaining: number }>({
		frame: null,
		remaining: 0,
	});
	const playing = inView && pageVisible && !paused && !reducedMotion;
	useEffect(() => {
		const updateVisibility = () => setPageVisible(!document.hidden);
		updateVisibility();
		document.addEventListener("visibilitychange", updateVisibility);
		return () =>
			document.removeEventListener("visibilitychange", updateVisibility);
	}, []);

	useEffect(() => {
		if (clock.current.frame !== frame) {
			clock.current = { frame, remaining: frame.duration };
		}
		if (!playing) return;
		const started = performance.now();
		const timer = window.setTimeout(() => {
			setPlayback((current) =>
				current.step + 1 < STORYBOARD[current.phase].length
					? { ...current, step: current.step + 1 }
					: { phase: current.phase === "boot" ? "shutdown" : "boot", step: 0 },
			);
		}, clock.current.remaining);
		return () => {
			window.clearTimeout(timer);
			clock.current.remaining = Math.max(
				0,
				clock.current.remaining - (performance.now() - started),
			);
		};
	}, [frame, playing]);

	return {
		frame,
		phase: playback.phase,
		paused,
		playing,
		reducedMotion,
		togglePaused: () => setPaused((value) => !value),
	};
}
