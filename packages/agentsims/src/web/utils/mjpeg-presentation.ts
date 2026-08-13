/** A decoded MJPEG load is presentable only when it belongs to the latest token. */
export function isCurrentMjpegPresentation(
  expectedUrl: string | null,
  loadedUrl: string,
  lastPresentedUrl: string | null,
): boolean {
  return expectedUrl !== null && loadedUrl === expectedUrl && loadedUrl !== lastPresentedUrl;
}
