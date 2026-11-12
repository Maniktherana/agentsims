import type { ReactNode } from "react";

/**
 * Opens and closes its content in place, with a hard clip. The grid row
 * animates from 0fr to 1fr, so no height is measured and nothing jumps at
 * the end. The row uses one duration and one curve for open and close, so
 * two reveals that change in the same render move together. The text of a
 * closing reveal fades out first. The content stays mounted, so the close can
 * play, and it is inert while closed. See `.reveal` in styles.css.
 */
export function Reveal({
	open,
	id,
	children,
}: {
	open: boolean;
	id?: string;
	children: ReactNode;
}) {
	return (
		<div id={id} className="reveal" data-open={open} inert={!open}>
			<div className="reveal-clip">{children}</div>
		</div>
	);
}
