import type { AndroidToolAction } from "../../android/contracts";

export function androidToolsUrl(
	basePath: string,
	deviceId: string,
	endpoint: string,
): string {
	return `${basePath.replace(/\/$/, "")}/android/${endpoint}?device=${encodeURIComponent(deviceId)}`;
}
export async function androidToolsRequest<T>(
	basePath: string,
	deviceId: string,
	endpoint: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(androidToolsUrl(basePath, deviceId, endpoint), {
		...init,
		headers: { "Content-Type": "application/json", ...init?.headers },
	});
	const value: unknown = await response.json();
	if (!response.ok)
		throw new Error(
			value && typeof value === "object" && "error" in value
				? String(value.error)
				: `Android request failed (${response.status})`,
		);
	return value as T;
}
export function runAndroidTool<T = unknown>(
	basePath: string,
	deviceId: string,
	action: AndroidToolAction,
	signal?: AbortSignal,
): Promise<T> {
	return androidToolsRequest(basePath, deviceId, "command", {
		method: "POST",
		body: JSON.stringify(action),
		signal,
	});
}
export function downloadAndroidText(
	name: string,
	content: string,
	type = "text/plain",
): void {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const link = document.createElement("a");
	link.href = url;
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
