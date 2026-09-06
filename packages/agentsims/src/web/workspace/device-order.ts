/** Catalog refreshes and reconnects must not reorder already visible devices. */
export function reconcileWorkspaceDeviceOrder(
	previous: readonly string[],
	visible: readonly string[],
): string[] {
	const known = new Set(previous);
	const next = [...previous];
	for (const id of visible) {
		if (known.has(id)) continue;
		known.add(id);
		next.push(id);
	}
	return next;
}
