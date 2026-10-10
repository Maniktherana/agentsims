/** Adds this tab's viewer ID to a device URL so the server can enforce the device holder. */
export function withViewer(url: string, viewer: string): string {
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}viewer=${encodeURIComponent(viewer)}`;
}
