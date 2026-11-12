import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "@tanstack/react-router";
import { useReducedMotion } from "motion/react";
import { cn } from "@agentsims/ui/lib/utils";
import { useViewportPlayback } from "../../hooks/use-viewport-playback";
import { indexLabel } from "../page";
import "./styles.css";

/*
 * A list of steps beside one picture that follows the active step. The loop
 * of the skill on the CLI page uses it.
 */

export type StepItem = {
	title: string;
	text: ReactNode;
	/** The id of the item, for a link such as `/#workspace-settings`. */
	id?: string;
};

type State = { active: number; run: number; phase: "entering" | "playing" };

/**
 * The sequence of a step list. One state value, `active`, drives the lit
 * item, `aria-pressed`, the accent bar, and the picture. A step change
 * first lets the picture enter (`enterMs`). Then the step plays (`playMs`)
 * and holds (`holdMs`), and the next step becomes active; after the last
 * step, the first is next. A click on another step makes it active. A click
 * on the active step plays it again. The sequence runs only while the list
 * is in view and the page is visible. With reduced motion there is no
 * sequence, and the picture shows the finished state of the selected step.
 * A URL hash that names an item selects it.
 */
export function useStepSequence({
	count,
	enterMs,
	playMs,
	holdMs,
	ids = [],
}: {
	count: number;
	enterMs: number;
	playMs: number;
	holdMs: number;
	ids?: readonly (string | undefined)[];
}) {
	const [ref, inView] = useViewportPlayback<HTMLDivElement>();
	const reducedMotion = useReducedMotion() ?? false;
	const [pageVisible, setPageVisible] = useState(true);
	const [state, setState] = useState<State>({ active: 0, run: 0, phase: "entering" });
	const running = inView && pageVisible && !reducedMotion;

	useEffect(() => {
		const update = () => setPageVisible(!document.hidden);
		update();
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);

	useEffect(() => {
		if (!running) return;
		const timer =
			state.phase === "entering"
				? window.setTimeout(
						() => setState((current) => ({ ...current, phase: "playing" })),
						enterMs,
					)
				: window.setTimeout(
						() =>
							setState((current) => ({
								active: (current.active + 1) % count,
								run: current.run + 1,
								phase: "entering",
							})),
						playMs + holdMs,
					);
		return () => window.clearTimeout(timer);
	}, [running, state.phase, state.run, count, enterMs, playMs, holdMs]);

	const select = (index: number) =>
		setState((current) => {
			if (index !== current.active)
				return { active: index, run: current.run + 1, phase: "entering" };
			// A click focuses the step first, so a step that is still entering
			// does not start again.
			if (current.phase === "entering") return current;
			return { active: index, run: current.run + 1, phase: "playing" };
		});

	// A hash that names an item selects it, on load and on a link.
	const hash = useLocation({ select: (location) => location.hash });
	const idKey = ids.join(" ");
	useEffect(() => {
		const index = idKey.split(" ").indexOf(hash.replace(/^#/, ""));
		if (hash && index >= 0)
			setState((current) =>
				current.active === index
					? current
					: { active: index, run: current.run + 1, phase: "entering" },
			);
	}, [hash, idKey]);

	return {
		ref,
		running,
		active: state.active,
		run: state.run,
		playing: running && state.phase === "playing",
		select,
	};
}

/**
 * The steps as buttons: a number, a name, and one sentence. The active step
 * is in full color with a 2px accent bar at its left; the others are dim.
 */
export function StepList({
	items,
	active,
	onSelect,
}: {
	items: StepItem[];
	active: number;
	onSelect: (index: number) => void;
}) {
	// The top and the height of each item. The bar reads the entry of the
	// active item in the same render, so it never shows another step.
	const listRef = useRef<HTMLOListElement>(null);
	const [rects, setRects] = useState<{ top: number; height: number }[]>([]);
	useLayoutEffect(() => {
		const list = listRef.current;
		if (!list) return;
		const measure = () =>
			setRects(
				[...list.children]
					.filter((child): child is HTMLElement => child.tagName === "LI")
					.map((item) => ({ top: item.offsetTop, height: item.offsetHeight })),
			);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(list);
		return () => observer.disconnect();
	}, []);
	const bar = rects[active];
	return (
		<div className="step-list">
			<ol ref={listRef} className="relative m-0 flex list-none flex-col gap-10 p-0">
				{items.map((item, index) => {
					const current = index === active;
					return (
						<li key={item.title} id={item.id} className="scroll-mt-24">
							<button
								type="button"
								aria-pressed={current}
								onClick={() => onSelect(index)}
								onFocus={() => {
									if (!current) onSelect(index);
								}}
								className="flex w-full cursor-pointer flex-col gap-1 ps-5 text-start"
							>
								<span className="flex items-baseline gap-3">
									<span className="t-label tabular-nums">{indexLabel(index)}</span>
									<span className={cn("t-h3", !current && "text-muted-foreground")}>
										{item.title}
									</span>
								</span>
								<span className={cn("t-body", !current && "text-faint")}>{item.text}</span>
							</button>
						</li>
					);
				})}
				{bar && (
					<span
						aria-hidden="true"
						className="step-list-bar"
						style={{ height: bar.height, transform: `translateY(${bar.top}px)` }}
					/>
				)}
			</ol>
		</div>
	);
}
