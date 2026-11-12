/** A powered-off screen. Shown until the first frame arrives. */
export function StreamPlaceholder() {
	return (
		<div
			data-agentsims-stream-placeholder="true"
			className="absolute inset-0 bg-[#050505]"
		/>
	);
}
