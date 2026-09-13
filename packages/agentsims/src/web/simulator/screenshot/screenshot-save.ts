export function downloadScreenshot(
	blob: Blob,
	deviceId: string,
	signal: AbortSignal,
): void {
	signal.throwIfAborted();
	const href = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = href;
	link.download = `agentsims-${deviceId.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}.png`;
	document.body.append(link);
	link.click();
	link.remove();
	// Give the browser time to consume the URL before releasing the image.
	setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
