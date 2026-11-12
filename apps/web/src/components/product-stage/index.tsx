import type { ReactNode } from "react";

/**
 * Renders every product picture on the site: the picture centered in its
 * column, at most 880px wide. Only the workspace picture has the workspace
 * dot grid behind it (`grid`). The picture takes
 * no pointer input and no text selection, and reads as one image. The
 * children size themselves to the width of the stage.
 *
 * `interactive` keeps the subtree in the accessibility tree for a control
 * inside the picture, such as the play button under reduced motion. The
 * control must set its own `pointer-events`.
 */
export function ProductStage({
	label,
	interactive = false,
	align = "center",
	grid = false,
	children,
}: {
	/** What the picture shows, for screen readers. */
	label: string;
	interactive?: boolean;
	/** `start` puts the picture at the left edge of its column. */
	align?: "center" | "start";
	/** Draws the workspace dot grid. Only the workspace picture has it. */
	grid?: boolean;
	children: ReactNode;
}) {
	return (
		<div role="img" aria-label={label} className="product-stage product-ui">
			<div
				className="product-stage-picture product-stage-inert"
				data-grid={grid || undefined}
				style={align === "start" ? { marginInlineStart: 0 } : undefined}
				aria-hidden={interactive ? undefined : true}
				inert={interactive ? undefined : true}
			>
				{children}
			</div>
		</div>
	);
}
