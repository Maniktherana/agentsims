import { useRef } from "react";
import { MotionConfig } from "motion/react";
import { Pause, Play } from "lucide-react";
import { TextMorph } from "torph/react";
import { IconSwap } from "../ui/icon-swap";
import { BrowserFrame } from "./browser-frame";
import { DemoCursor } from "./cursor";
import { DemoDock } from "./dock";
import { demoDevices } from "./dock/devices";
import { DemoPhones } from "./phones";
import { DOCK_SCALE, SURFACE } from "./motion";
import { useCursorTargets } from "./use-cursor-targets";
import { useDemoPlayback } from "./use-playback";

export function ProductDemo() {
	const sceneRef = useRef<HTMLDivElement>(null);
	const { frame, phase, paused, playing, reducedMotion, togglePaused } =
		useDemoPlayback(sceneRef);
	const { sceneScale, target } = useCursorTargets(sceneRef, frame, phase);
	const devices = demoDevices(frame.android);
	const scale = sceneScale * DOCK_SCALE;
	return (
		<MotionConfig reducedMotion="user" transition={SURFACE.spring}>
			<div className="product-stage">
				<BrowserFrame>
					<div
						className="demo-scene"
						ref={sceneRef}
						data-stage={frame.name}
						data-phase={reducedMotion ? "static" : phase}
						data-playing={playing}
					>
						<DemoPhones
							androidVisible={devices.androidVisible}
							androidStreaming={frame.android === "streaming"}
							scale={scale}
						/>
						<DemoDock expanded={!!frame.dock} scale={scale} devices={devices} />
						<DemoCursor
							target={target}
							visible={!!frame.pointer}
							reducedMotion={reducedMotion}
						/>
					</div>
				</BrowserFrame>
				<div className="demo-caption">
					<p className="sr-only">
						Demo: boot an Android device beside an iOS simulator, then shut down
						Android from the dock. The sequence repeats.
					</p>
					{!reducedMotion && (
						<button
							type="button"
							className="demo-replay button-press"
							onClick={togglePaused}
						>
							<IconSwap state={paused ? "paused" : "playing"}>
								{paused ? <Play /> : <Pause />}
							</IconSwap>
							<TextMorph>{paused ? "Resume demo" : "Pause demo"}</TextMorph>
						</button>
					)}
				</div>
			</div>
		</MotionConfig>
	);
}
