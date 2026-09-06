export interface WorkspaceDevicePosition {
	left: number;
	top: number;
	right: number;
}

/** Reserve the target immediately so a batch of new devices cannot overlap. */
export function reserveWorkspaceDevicePosition(
	positions: Map<string, WorkspaceDevicePosition>,
	visibleDeviceIds: readonly string[],
	deviceId: string,
	current: WorkspaceDevicePosition,
	added: boolean,
): WorkspaceDevicePosition {
	const previous = positions.get(deviceId);
	const right = Math.max(
		0,
		...visibleDeviceIds.flatMap((id) => {
			const position = id === deviceId ? undefined : positions.get(id);
			return position ? [position.right] : [];
		}),
	);
	const left = Math.max(
		12,
		previous?.left ?? (added && right > 0 ? right + 20 : current.left),
	);
	const next = {
		left,
		top: Math.max(12, previous?.top ?? current.top),
		right: left + current.right - current.left,
	};
	positions.set(deviceId, next);
	return next;
}
