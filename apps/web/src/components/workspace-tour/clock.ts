import { useCallback, useEffect, useRef, useState } from "react";
import type { Tour } from "./script";

/** Where the clock is: the step of the tour, how far into it, and whether time runs. */
export interface Progress {
	/** The step (script.ts, STEPS). */
	index: number;
	/** 0 to 1 through the step, at `wall`. */
	fraction: number;
	/** The step's length, so a running fill knows its speed. */
	length: number;
	running: boolean;
	/** performance.now() when this was measured. */
	wall: number;
}

/** The step a time falls in, and how far into it. The reset belongs to the last step. */
function progressAt(tour: Tour, time: number, running: boolean): Progress {
	const last = tour.marks.length - 2;
	let index = 0;
	while (index < last && time >= tour.marks[index + 1]!) index += 1;
	const start = tour.marks[index]!;
	const end = index === last ? tour.length : tour.marks[index + 1]!;
	return {
		index,
		fraction: Math.min(1, Math.max(0, (time - start) / (end - start))),
		length: end - start,
		running,
		wall: typeof performance === "undefined" ? 0 : performance.now(),
	};
}

/**
 * Runs the steps of a loop. The clock advances only while `playing` and
 * wraps at the tour's length. It sleeps between steps with one timer, so a
 * paused picture does no work, and it resumes where it stopped. A step that
 * shows a screen waits on `ready` for that image: the picture holds its
 * current frame until the image is decoded. Every start, stop, hold and
 * step boundary is reported, so the step bar and the caption follow this
 * one clock. `seek` moves the clock to a time without running the steps
 * before it; the caller puts the picture in that time's state first.
 */
export function useLoopClock(
	tour: Tour,
	playing: boolean,
	ready: (srcs: readonly string[]) => Promise<void> | null,
) {
	const { steps, length } = tour;
	const time = useRef(0);
	const next = useRef(0);
	// Another story starts from its beginning.
	const story = useRef(tour);
	if (story.current !== tour) {
		story.current = tour;
		time.current = 0;
		next.current = 0;
	}
	// The first reading carries no wall time, so the server and the client draw the same bar.
	const [progress, setProgress] = useState(() => ({ ...progressAt(tour, 0, false), wall: 0 }));
	const [seeks, setSeeks] = useState(0);
	const pendingSeek = useRef<number | null>(null);

	useEffect(() => {
		const sought = pendingSeek.current !== null;
		if (pendingSeek.current !== null) {
			time.current = pendingSeek.current;
			next.current = tour.indexAt(pendingSeek.current);
			pendingSeek.current = null;
		}
		if (!playing) {
			setProgress(progressAt(tour, time.current, false));
			return;
		}
		let base = time.current;
		let wall = performance.now();
		const read = () => base + performance.now() - wall;
		let timer = 0;
		let stopped = false;
		let shownIndex = -1;
		const report = (t: number, running: boolean) => {
			const p = progressAt(tour, t, running);
			shownIndex = running ? p.index : -1;
			setProgress(p);
		};
		const tick = () => {
			let t = read();
			for (;;) {
				while (next.current < steps.length && steps[next.current]!.at <= t) {
					const step = steps[next.current]!;
					const wait = step.needs ? ready(step.needs) : null;
					if (wait) {
						// Hold on this frame. The clock starts again at this step when the image is ready.
						base = step.at;
						time.current = step.at;
						report(step.at, false);
						void wait.then(() => {
							if (stopped) return;
							wall = performance.now();
							report(step.at, true);
							tick();
						});
						return;
					}
					step.run();
					next.current += 1;
				}
				if (next.current < steps.length || t < length) break;
				base -= length;
				t -= length;
				next.current = 0;
			}
			if (progressAt(tour, t, true).index !== shownIndex) report(t, true);
			// Wake at the next step or the next step boundary, whichever comes first.
			const boundary = tour.marks.find((mark) => mark > t) ?? length;
			const due = Math.min(next.current < steps.length ? steps[next.current]!.at : length, boundary);
			timer = window.setTimeout(tick, Math.max(0, due - t));
		};
		// After a seek the picture is drawn once in its new state, the pointer at rest, before the story moves.
		const frame = sought ? requestAnimationFrame(() => {
			wall = performance.now();
			tick();
		}) : 0;
		if (!sought) tick();
		return () => {
			stopped = true;
			cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			// A story that was replaced keeps the new one's start; a seek keeps its time.
			if (story.current !== tour || pendingSeek.current !== null) return;
			time.current = Math.min(read(), next.current < steps.length ? steps[next.current]!.at : length);
			setProgress(progressAt(tour, time.current, false));
		};
	}, [playing, tour, steps, length, ready, seeks]);

	const seek = useCallback(
		(to: number) => {
			pendingSeek.current = to;
			setProgress(progressAt(tour, to, false));
			setSeeks((n) => n + 1);
		},
		[tour],
	);
	return { progress, seek };
}
