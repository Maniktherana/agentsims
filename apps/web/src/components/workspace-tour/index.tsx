import { MotionConfig, useInView } from "motion/react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
	type CSSProperties,
	type RefObject,
} from "react";
import { useReducedMotionAfterHydration } from "../../hooks/use-reduced-motion-after-hydration";
import { useViewportPlayback } from "../../hooks/use-viewport-playback";
import { useLoopClock, type Progress } from "./clock";
import { TourCursor } from "./cursor";
import { ALL_SCREENS, CAPTIONS } from "./data";
import { MIN_WIDTH, TALL_FROM, ZOOM, designFor } from "./layout";
import { loadScreens, screensReady } from "./screens";
import { STEPS, buildTour, restPoint, type CursorState } from "./script";
import { INITIAL_STATE, tourReducer, type TourAction } from "./state";
import { StepsBar } from "./steps-bar";
import { TourWindow } from "./workspace";
import "./styles.css";

const LABEL =
	"The Agentsims workspace in a browser, with iPhone 17 and Pixel 10. A pointer shuts down Pixel 10 from Devices, " +
	"moves iPhone 17 aside, and sets its appearance to Dark in Settings. It opens Safari and types manikrana.dev on the phone, " +
	"then the Crema app. It adds the note “should be cart icon” to the cart button and copies the prompt. " +
	"It selects the Add to bag button in the accessibility tree, opens each call of an agent run in Traces, " +
	"and boots Pixel 10 again.";

const POSTER_LABEL =
	"The Agentsims workspace in a browser. iPhone 17 shows the Crema app in Dark. " +
	"The accessibility tree is open, and the Add to bag button is selected, with its role, label and bounds.";

/**
 * The near margin: the screens start to load one and a half viewports before
 * the picture comes into view. On Fast 3G the first frame takes about a
 * second, and a reader scrolls about a viewport in that time.
 */
const NEAR_MARGIN = "150% 0px 150% 0px";
/** With reduced motion the picture shows the end of this step: the Inspector payoff. */
const POSTER_STEP = 4;
const STEP_NAMES = STEPS.map((id) => CAPTIONS.find((caption) => caption.id === id)!.name);

/**
 * The whole Agentsims workspace in a browser window, a bar of its steps, and
 * a caption that names the tool in use. A cursor plays the story of
 * script.ts in a loop, only while the picture is in view and the tab is
 * visible. A press on a step jumps to it. With reduced motion nothing plays:
 * the picture shows the Inspector payoff, and a press shows the end of a step.
 */
export function WorkspaceTour() {
	const [state, rawDispatch] = useReducer(tourReducer, INITIAL_STATE);
	// The state as the script last left it, ahead of React's render, so a replayed step reads its own result.
	const scriptState = useRef(INITIAL_STATE);
	const dispatch = useCallback((action: TourAction) => {
		scriptState.current = tourReducer(scriptState.current, action);
		rawDispatch(action);
	}, []);
	const [cursor, setCursor] = useState<CursorState | null>(null);
	const [rootRef, inView] = useViewportPlayback<HTMLDivElement>();
	const near = useInView(rootRef, { margin: NEAR_MARGIN, once: true });
	const stageRef = useRef<HTMLDivElement>(null);
	const cursorRef = useRef(cursor);
	cursorRef.current = cursor;

	useEffect(() => {
		if (near) loadScreens();
	}, [near]);

	const width = useContainerWidth(rootRef);
	const design = useMemo(() => designFor(width), [width]);
	const designRef = useRef(design);
	designRef.current = design;
	// The story is built again only when its shape changes: the window's height, or room for the move aside. Not on every width.
	const shape = `${design.viewH}:${design.aside}`;

	const tour = useMemo(
		() =>
			buildTour({
				stage: () => stageRef.current,
				design: () => designRef.current,
				cursorSize: () => 24 / zoomRef.current,
				state: () => scriptState.current,
				dispatch,
				cursor: () => cursorRef.current,
				setCursor: (next) => {
					cursorRef.current = next;
					setCursor(next);
				},
			}),
		[shape, dispatch],
	);
	// A story of another shape starts from its first frame.
	const startedShape = useRef(shape);
	useEffect(() => {
		if (startedShape.current === shape) return;
		startedShape.current = shape;
		dispatch({ type: "reset", state: INITIAL_STATE });
	}, [shape, dispatch]);

	// The server renders the first frame of the loop; the poster replaces it after hydration.
	const reducedMotion = useReducedMotionAfterHydration();
	const pageVisible = usePageVisible();
	const playing = inView && pageVisible && !reducedMotion;
	const { progress, seek } = useLoopClock(tour, playing, screensReady);

	// A jump draws the picture again from the state the script reaches at that time, with nothing in motion.
	const [epoch, setEpoch] = useState(0);
	const [still, setStill] = useState<number | null>(null);
	const jumpId = useRef(0);
	const show = useCallback(
		(index: number, finished: boolean) => {
			const id = (jumpId.current += 1);
			const apply = () => {
				if (id !== jumpId.current) return;
				const until = finished ? tour.marks[index + 1]! : tour.marks[index]!;
				dispatch({ type: "reset", state: INITIAL_STATE });
				for (const step of tour.steps) if (step.at < until) step.run();
				// The pointer is put down at the step's rest point: nothing it hovered or pressed stays, and no toast is left over.
				for (const action of [
					{ type: "pointer", target: null },
					{ type: "press", target: null },
					{ type: "touch", at: null },
					{ type: "hover", path: null },
					{ type: "toast", on: false },
				] satisfies TourAction[])
					dispatch(action);
				setEpoch((n) => n + 1);
				if (finished) setStill(index);
				else seek(until);
			};
			const wait = screensReady(ALL_SCREENS);
			if (wait) void wait.then(apply);
			else apply();
		},
		[tour, dispatch, seek],
	);
	const jump = useCallback((index: number) => show(index, reducedMotion), [show, reducedMotion]);
	// With reduced motion the picture shows the poster once the screens are near.
	useEffect(() => {
		if (reducedMotion && near && still === null) show(POSTER_STEP, true);
	}, [reducedMotion, near, still, show]);
	// After a jump the cursor rests where the step begins.
	useLayoutEffect(() => {
		if (epoch === 0 || reducedMotion) return;
		const stage = stageRef.current;
		const p = stage ? restPoint(stage) : null;
		if (p) {
			// Put down at the rest point, not carried there from where the replay left it.
			const next: CursorState = { x: p.x, y: p.y, pressed: false, kind: "arrow", travel: { duration: 0, ease: [0, 0, 1, 1] } };
			cursorRef.current = next;
			setCursor(next);
		}
	}, [epoch, reducedMotion]);

	// The zoom of the window, as styles.css computes it. The cursor keeps its page size at any zoom.
	const zoom = width === null ? ZOOM : Math.min(ZOOM, width / MIN_WIDTH);
	const zoomRef = useRef(zoom);
	zoomRef.current = zoom;
	const shownProgress: Progress =
		reducedMotion && still !== null ? { index: still, fraction: 1, length: 1, running: false, wall: 0 } : progress;
	const caption = STEPS[shownProgress.index]!;

	return (
		<div
			className="wt-root flex min-w-0 flex-col gap-6"
			style={
				{
					"--wt-zoom": ZOOM,
					"--wt-min-w": `${MIN_WIDTH}px`,
					"--wt-min-w-n": MIN_WIDTH,
				} as CSSProperties
			}
		>
			<div className="relative">
				<div ref={rootRef} className="wt-tour" role="img" aria-label={reducedMotion ? POSTER_LABEL : LABEL}>
					<div className="wt-host product-ui">
						<MotionConfig reducedMotion="user">
							<div
								ref={stageRef}
								className="wt"
								data-short={(width !== null && width < TALL_FROM) || undefined}
								data-design-height={design.height}
								data-paused={!playing || undefined}
								data-measuring={width === null || undefined}
								aria-hidden="true"
								inert
							>
								<Fragment key={epoch}>
									<TourWindow design={design} state={state} />
									<div className="wt-overlay">
										{cursor && !reducedMotion ? (
											<TourCursor
												x={cursor.x}
												y={cursor.y}
												pressed={cursor.pressed}
												kind={cursor.kind}
												travel={cursor.travel}
												size={24 / zoom}
											/>
										) : null}
									</div>
								</Fragment>
							</div>
						</MotionConfig>
					</div>
				</div>
				<StepsBar names={STEP_NAMES} progress={shownProgress} onJump={jump} />
			</div>
			{/* The label of the picture says the same, so the caption is for sight only. */}
			<ul className="wt-caption m-0 list-none p-0" aria-hidden="true">
				{CAPTIONS.map((item) => (
					<li key={item.id} data-active={item.id === caption || undefined}>
						<span className="t-h3">{item.name}</span> <span className="t-body">{item.text}</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function usePageVisible() {
	const [visible, setVisible] = useState(true);
	useEffect(() => {
		const update = () => setVisible(!document.hidden);
		update();
		document.addEventListener("visibilitychange", update);
		return () => document.removeEventListener("visibilitychange", update);
	}, []);
	return visible;
}

/** The width of the element, or null before the first measure. */
function useContainerWidth(ref: RefObject<HTMLElement | null>) {
	const [width, setWidth] = useState<number | null>(null);
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const update = () => setWidth(element.getBoundingClientRect().width);
		update();
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
	return width;
}
