import { useMemo } from "react";
import { arc, motion } from "motion/react";
import type { CursorPoint } from "./use-cursor-targets";

const POINTER = {
	travel: { duration: 0.45, ease: [0.25, 0.1, 0.25, 1] as const },
	fade: { duration: 0.12 },
};
export function DemoCursor({
	target,
	visible,
	reducedMotion,
}: {
	target: CursorPoint;
	visible: boolean;
	reducedMotion: boolean | null;
}) {
	const pointerPath = useMemo(
		() => arc({ strength: 0.3, peak: 0.15, rotate: 0.9, direction: "cw" }),
		[],
	);
	return (
		<motion.div
			className="pointer-events-none absolute top-0 left-0 z-[8] aspect-square w-[5cqw] drop-shadow-[0_2px_2px_#0008]"
			initial={false}
			animate={target}
			style={{ originX: 3.58 / 24, originY: 3.58 / 24 }}
			transition={{
				...POINTER.travel,
				path: reducedMotion ? undefined : pointerPath,
			}}
		>
			<motion.svg
				className="block h-full w-full"
				viewBox="0 0 24 24"
				initial={false}
				style={{ originX: 3.58 / 24, originY: 3.58 / 24 }}
				animate={{
					opacity: visible ? 1 : 0,
				}}
				transition={POINTER.fade}
			>
				<path
					d="M18.5762 8.94287L4.87859 3.58295C4.06653 3.26519 3.26519 4.06653 3.58295 4.8786L8.94287 18.5762C9.20565 19.2477 10.0713 19.4288 10.5812 18.9189L12.1465 17.3536C12.3417 17.1583 12.6583 17.1583 12.8536 17.3536L16.6465 21.1465C16.8417 21.3417 17.1583 21.3417 17.3536 21.1465L21.1465 17.3536C21.3417 17.1583 21.3417 16.8417 21.1465 16.6465L17.3536 12.8536C17.1583 12.6583 17.1583 12.3417 17.3536 12.1465L18.9189 10.5812C19.4288 10.0713 19.2477 9.20565 18.5762 8.94287Z"
					fill="black"
					stroke="white"
					strokeLinecap="round"
					strokeWidth="1.5"
					strokeLinejoin="round"
				/>
			</motion.svg>
		</motion.div>
	);
}
