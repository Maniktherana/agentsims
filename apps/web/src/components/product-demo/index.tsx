import { useRef } from "react";
import { MotionConfig } from "motion/react";
import { BrowserFrame } from "./browser-frame";
import { DemoCursor } from "./cursor";
import { DemoDock } from "./dock";
import { demoDevices } from "./dock/devices";
import { DemoPhones } from "./phones";
import { DOCK_SCALE, SURFACE } from "./motion";
import { useCursorTargets } from "./use-cursor-targets";
import { useDemoPlayback } from "./use-playback";
import type { Intro } from "../intro/use-intro";

export function ProductDemo({ intro }: { intro: Intro }) {
	const sceneRef = useRef<HTMLDivElement>(null);
	const { frame, phase, playing, reducedMotion } = useDemoPlayback(
		sceneRef,
		intro.reached("running"),
	);
	const { sceneScale, target } = useCursorTargets(sceneRef, frame, phase);
	const devices = demoDevices(frame.android);
	const scale = sceneScale * DOCK_SCALE;
	return (
		<MotionConfig reducedMotion="user" transition={SURFACE.spring}>
			<div className="relative max-md:mx-auto max-md:mt-6 max-md:w-[calc(100%-2.5rem)] max-md:max-w-2xl">
				<BrowserFrame
					lit={intro.reached("screen")}
					chrome={intro.reached("workspace")}
				>
					<div
						className="demo-scene @container absolute right-[7%] bottom-[7%] z-[2] aspect-[480/530] w-[min(40%,36rem)] [direction:ltr] max-md:relative max-md:inset-auto max-md:mx-auto max-md:w-full max-md:max-w-md"
						ref={sceneRef}
						data-stage={frame.name}
						data-phase={reducedMotion ? "static" : phase}
						data-playing={playing}
					>
						<DemoPhones
							iphoneVisible={intro.reached("workspace")}
							androidVisible={devices.androidVisible}
							androidStreaming={frame.android === "streaming"}
							scale={scale}
						/>
						<DemoDock
							visible={intro.reached("workspace")}
							expanded={!!frame.dock}
							scale={scale}
							devices={devices}
						/>
						<DemoCursor
							target={target}
							visible={!!frame.pointer}
							reducedMotion={reducedMotion}
						/>
					</div>
				</BrowserFrame>
				<p className="sr-only">
					Demo: boot an Android device beside an iOS simulator, then shut down
					Android from the dock. The sequence repeats.
				</p>
			</div>
		</MotionConfig>
	);
}
