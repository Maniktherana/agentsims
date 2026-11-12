import { useEffect, useState, type RefObject } from "react";
import type { DemoFrame, DemoPlayback, PointerTarget } from "./storyboard";

export type CursorPoint = { x: number; y: number };

export function useCursorTargets(
	sceneRef: RefObject<HTMLDivElement | null>,
	frame: DemoFrame,
	phase: DemoPlayback["phase"],
) {
	const [sceneScale, setSceneScale] = useState(1);
	const [targets, setTargets] = useState({
		start: { x: 0, y: 0 },
		dock: { x: 0, y: 0 },
		device: { x: 0, y: 0 },
		shutdown: { x: 0, y: 0 },
	});
	useEffect(() => {
		const scene = sceneRef.current;
		if (!scene) return;
		function measure() {
			if (!scene) return;
			// The product stage can scale the scene with a transform. The
			// rects are on screen, and the cursor is placed in the scene, so
			// the rects are divided by that scale.
			const bounds = scene.getBoundingClientRect();
			const stageScale = scene.offsetWidth ? bounds.width / scene.offsetWidth : 1;
			const pointerScale = scene.offsetWidth / 480;
			// The scale changes only when the layout does, by half a pixel or more.
			setSceneScale((previous) =>
				Math.abs(previous - pointerScale) * 480 < 0.5 ? previous : pointerScale,
			);
			const local = (rect: DOMRect | undefined) =>
				rect && {
					x: (rect.x - bounds.x) / stageScale,
					y: (rect.y - bounds.y) / stageScale,
					width: rect.width / stageScale,
					height: rect.height / stageScale,
				};
			const height = bounds.height / stageScale;
			const width = bounds.width / stageScale;
			const dock = local(
				scene
					.querySelector<HTMLElement>('[aria-label^="Devices,"]')
					?.getBoundingClientRect(),
			);
			const pixelRow = scene.querySelector<HTMLElement>(
				'[aria-label^="Pixel 10,"]',
			);
			const row = local(pixelRow?.getBoundingClientRect());
			const power = local(
				pixelRow
					?.querySelector<HTMLElement>('[aria-label="Shut down device"]')
					?.getBoundingClientRect(),
			);
			// The supplied cursor's tip is inset 3.58 units in its 24-unit viewBox.
			const tip = 3.58 * pointerScale;
			setTargets((previous) => {
				const next = {
					start: { x: width * 0.72, y: height * 0.57 },
					dock: dock
						? {
								x: dock.x + dock.width / 2 - tip,
								y: dock.y + dock.height / 2 - tip,
							}
						: previous.dock,
					// The cursor stays on the Pixel row that it pressed. When the
					// row moves to Running, the cursor follows it.
					device:
						row && phase === "boot"
							? {
									x: row.x + row.width * 0.6 - tip,
									y: row.y + row.height / 2 - tip,
								}
							: previous.device,
					shutdown:
						power && phase === "shutdown" && frame.android === "streaming"
							? {
									x: power.x + power.width / 2 - tip,
									y: power.y + power.height / 2 - tip,
								}
							: previous.shutdown,
				};
				let changed = false;
				for (const key of Object.keys(next) as PointerTarget[]) {
					// Dock layout can drift by a fraction of a pixel while opening.
					// Replaying an arc for that drift still applies its full rotation.
					if (
						Math.hypot(
							next[key].x - previous[key].x,
							next[key].y - previous[key].y,
						) < 1
					) {
						next[key] = previous[key];
					} else {
						changed = true;
					}
				}
				return changed ? next : previous;
			});
		}
		measure();
		// The dock panel moves in with a transform, which a ResizeObserver
		// does not report, so the targets are measured again after it.
		const settle = window.setTimeout(measure, 400);
		const observer = new ResizeObserver(measure);
		observer.observe(scene);
		const panel = scene.querySelector("[data-agentsims-floating-panel]");
		if (panel) observer.observe(panel);
		return () => {
			window.clearTimeout(settle);
			observer.disconnect();
		};
	}, [sceneScale, frame, phase]);

	return { sceneScale, target: targets[frame.pointer ?? "start"] };
}
