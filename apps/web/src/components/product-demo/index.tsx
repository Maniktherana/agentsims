import { useRef } from "react";
import { MotionConfig } from "motion/react";
import { DemoCursor } from "./cursor";
import { DemoDock } from "./dock";
import { demoDevices } from "./dock/devices";
import { DemoPhones } from "./phones";
import { DOCK_SCALE, SURFACE } from "./motion";
import { useCursorTargets } from "./use-cursor-targets";
import { useDemoPlayback } from "./use-playback";

export function ProductDemo() {
	const sceneRef = useRef<HTMLDivElement>(null);
	const { frame, phase, playing, reducedMotion } = useDemoPlayback(sceneRef);
	const { sceneScale, target } = useCursorTargets(sceneRef, frame, phase);
	const devices = demoDevices(frame.android);
	const scale = sceneScale * DOCK_SCALE;
	return (
		<MotionConfig reducedMotion="user" transition={SURFACE.spring}>
			<div className="workspace-tile select-none">
				{/* The name bars sit above the phones, so the tile keeps room for
				    them at the top. The scene is sized in layout pixels, and the
				    phones and the dock use `zoom`, as before. A transform scale
				    would snap the dock by a subpixel when its animation ends. */}
				<div className="pt-16 pb-7" aria-hidden="true" inert>
					<div
						className="demo-scene @container relative mx-auto aspect-[480/530] w-full max-w-(--workspace-scene-width,480px) [direction:ltr]"
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
						<DemoDock
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
				</div>
			</div>
		</MotionConfig>
	);
}
