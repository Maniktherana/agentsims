// Fixed outline geometry for the demo's two phone frames.
const OUTLINES = {
	android: {
		size: 29,
		path: "M 25.226 13.863 A 15.600 15.600 0 0 1 13.863 25.226",
	},
	iphone: {
		size: 31,
		path: "M 26.863 14.405 A 17.103 17.103 0 0 1 14.405 26.863",
	},
};

export function ResizeHandle({
	android,
	scale,
}: {
	android: boolean;
	scale: number;
}) {
	const { size, path } = OUTLINES[android ? "android" : "iphone"];
	return (
		<div
			className="pointer-events-none absolute z-[4] origin-bottom-right"
			style={{
				right: -14 * scale,
				bottom: -14 * scale,
				transform: `scale(${scale})`,
			}}
		>
			<svg
				data-agentsims-resize-affordance
				width={size}
				height={size}
				viewBox={`0 0 ${size} ${size}`}
				fill="none"
				aria-hidden="true"
				shapeRendering="geometricPrecision"
				className="pointer-events-none block overflow-visible"
			>
				<path
					data-agentsims-resize-main-stroke
					d={path}
					stroke="oklch(0.53653 0.017264 260.712)"
					strokeWidth={2.65}
					strokeLinecap="round"
					vectorEffect="non-scaling-stroke"
					className="opacity-[0.38] contrast-more:opacity-100 contrast-more:[stroke-width:2.968px]"
					style={{
						filter:
							"drop-shadow(0 0.5px 1px oklch(0 0 0 / 0.1)) drop-shadow(0 2px 5px oklch(0 0 0 / 0.13))",
					}}
				/>
			</svg>
		</div>
	);
}
