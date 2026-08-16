export const PRESENTED_STREAM_STALE_MS = 5_000;

export function isPresentedStreamStale(
	lastFrameAt: number,
	now: number,
): boolean {
	return lastFrameAt > 0 && now - lastFrameAt > PRESENTED_STREAM_STALE_MS;
}
