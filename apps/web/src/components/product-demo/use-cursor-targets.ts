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
			const bounds = scene.getBoundingClientRect();
			const pointerScale = bounds.width / 480;
			setSceneScale(pointerScale);
			const dock = scene
				.querySelector<HTMLElement>('[aria-label^="Devices,"]')
				?.getBoundingClientRect();
			const pixelRow = scene.querySelector<HTMLElement>(
				'[aria-label^="Pixel 10,"]',
			);
			const row = pixelRow?.getBoundingClientRect();
			const power = pixelRow
				?.querySelector<HTMLElement>('[aria-label="Shut down device"]')
				?.getBoundingClientRect();
			// The supplied cursor's tip is inset 3.58 units in its 24-unit viewBox.
			const tip = 3.58 * pointerScale;
			setTargets((previous) => {
				const next = {
					start: { x: bounds.width * 0.72, y: bounds.height * 0.57 },
					dock: dock
						? {
								x: dock.x + dock.width / 2 - bounds.x - tip,
								y: dock.y + dock.height / 2 - bounds.y - tip,
							}
						: previous.dock,
					device:
						row && phase === "boot" && frame.android === "available"
							? {
									x: row.x + row.width * 0.6 - bounds.x - tip,
									y: row.y + row.height / 2 - bounds.y - tip,
								}
							: previous.device,
					shutdown:
						power && phase === "shutdown" && frame.android === "streaming"
							? {
									x: power.x + power.width / 2 - bounds.x - tip,
									y: power.y + power.height / 2 - bounds.y - tip,
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
		const observer = new ResizeObserver(measure);
		observer.observe(scene);
		const panel = scene.querySelector("[data-agentsims-floating-panel]");
		if (panel) observer.observe(panel);
		return () => observer.disconnect();
	}, [sceneScale, frame, phase]);

	return { sceneScale, target: targets[frame.pointer ?? "start"] };
}
