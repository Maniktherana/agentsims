export interface WorkspaceDevicePosition {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

const DEVICE_GAP = 20;

/** Reserve the nearest free slot beside the active phone before placing a batch. */
export function reserveWorkspaceDevicePosition(
	positions: Map<string, WorkspaceDevicePosition>,
	visibleDeviceIds: readonly string[],
	deviceId: string,
	current: WorkspaceDevicePosition,
	added: boolean,
	anchorDeviceId?: string | null,
): WorkspaceDevicePosition {
	const previous = added ? undefined : positions.get(deviceId);
	const occupied = visibleDeviceIds.flatMap((id) => {
		const position = id === deviceId ? undefined : positions.get(id);
		return position ? [position] : [];
	});
	const anchor =
		(anchorDeviceId &&
		anchorDeviceId !== deviceId &&
		visibleDeviceIds.includes(anchorDeviceId)
			? positions.get(anchorDeviceId)
			: undefined) ?? occupied.at(-1);
	const width = current.right - current.left;
	const height = current.bottom - current.top;
	const top = previous?.top ?? (added && anchor ? anchor.top : current.top);
	let left = previous?.left ?? current.left;
	if (added && anchor) {
		// Try adjacent edges in distance order. A distant phone must not send the
		// new one to the far edge of the whole workspace.
		const preferredLeft = anchor.right + DEVICE_GAP;
		const candidates = [
			...new Set([
				preferredLeft,
				anchor.left - DEVICE_GAP - width,
				...occupied.flatMap((rect) => [
					rect.right + DEVICE_GAP,
					rect.left - DEVICE_GAP - width,
				]),
			]),
		].sort((a, b) => Math.abs(a - preferredLeft) - Math.abs(b - preferredLeft));
		left =
			candidates.find((candidate) =>
				occupied.every(
					(rect) =>
						candidate + width + DEVICE_GAP <= rect.left ||
						candidate >= rect.right + DEVICE_GAP ||
						top + height + DEVICE_GAP <= rect.top ||
						top >= rect.bottom + DEVICE_GAP,
				),
			) ?? preferredLeft;
	}
	const next = { left, top, right: left + width, bottom: top + height };
	positions.set(deviceId, next);
	return next;
}

/** Keep the active phone fixed and arrange the others around it in display order. */
export function arrangeWorkspaceDevicePositions(
	positions: ReadonlyMap<string, WorkspaceDevicePosition>,
	visibleDeviceIds: readonly string[],
	anchorDeviceId: string | null,
): Map<string, WorkspaceDevicePosition> {
	const ids = visibleDeviceIds.filter((id) => positions.has(id));
	const anchorIndex = Math.max(0, ids.indexOf(anchorDeviceId ?? ""));
	const anchorId = ids[anchorIndex];
	if (!anchorId) return new Map();
	const anchor = positions.get(anchorId)!;
	const arranged = new Map([[anchorId, { ...anchor }]]);
	const place = (id: string, left: number) => {
		const current = positions.get(id)!;
		const next = {
			left,
			top: anchor.top,
			right: left + current.right - current.left,
			bottom: anchor.top + current.bottom - current.top,
		};
		arranged.set(id, next);
		return next;
	};
	let left = anchor.left;
	for (let index = anchorIndex - 1; index >= 0; index--) {
		const id = ids[index]!;
		const current = positions.get(id)!;
		left = place(id, left - DEVICE_GAP - (current.right - current.left)).left;
	}
	let right = anchor.right;
	for (const id of ids.slice(anchorIndex + 1)) {
		right = place(id, right + DEVICE_GAP).right;
	}
	return arranged;
}
