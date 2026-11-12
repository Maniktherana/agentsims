import { useLayoutEffect, useRef } from "react";
import type { Progress } from "./clock";

/**
 * The steps of the tour under the window: one segment per step. Finished
 * steps are full, the current one fills as the clock runs, later ones are
 * empty. A press jumps the tour to the start of that step. This is site UI,
 * outside the picture.
 */
export function StepsBar({
	names,
	progress,
	onJump,
}: {
	names: readonly string[];
	progress: Progress;
	onJump: (index: number) => void;
}) {
	return (
		<div
			role="group"
			aria-label="Tour steps"
			className="wt-steps"
			// The clock's reading the fill starts from, for the tour's checks.
			data-step={progress.index}
			data-fraction={progress.fraction}
			data-length={progress.length}
			data-wall={progress.wall}
			data-running={progress.running || undefined}
		>
			{names.map((name, index) => (
				<button
					key={index}
					type="button"
					className="wt-step"
					aria-label={`Step ${index + 1} of ${names.length}: ${name}`}
					aria-current={index === progress.index ? "step" : undefined}
					onClick={() => onJump(index)}
				>
					<Fill progress={progress} index={index} />
				</button>
			))}
		</div>
	);
}

/** The fill of one segment. It moves with `transform: scaleX` only, and stops when the clock stops. */
function Fill({ progress, index }: { progress: Progress; index: number }) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const fill = ref.current;
		if (!fill) return;
		const current = index === progress.index;
		const from = current ? progress.fraction : index < progress.index ? 1 : 0;
		fill.style.transform = `scaleX(${from})`;
		if (!current || !progress.running) return;
		// The fill runs on the page timeline from the moment the clock read, so a late first frame does not put it behind.
		const animation = fill.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], {
			duration: progress.length,
			easing: "linear",
			fill: "forwards",
		});
		animation.startTime = progress.wall - progress.fraction * progress.length;
		return () => {
			// Keep the fill where the clock stopped it.
			fill.style.transform = getComputedStyle(fill).transform;
			animation.cancel();
		};
	}, [progress, index]);
	return <span ref={ref} className="wt-step-fill" aria-hidden="true" />;
}
