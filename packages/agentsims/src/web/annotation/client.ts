import { simEndpoint } from "../preview/sim-endpoint";
import type {
	AnnotationContextClient,
	AnnotationSendPayload,
} from "./live-contracts";

export function annotationContextClient(
	basePath?: string,
): AnnotationContextClient {
	const endpoint =
		basePath === undefined
			? simEndpoint("context")
			: `${basePath.replace(/\/+$/, "")}/context`;
	async function request(
		path: string,
		method: string,
		body?: unknown,
	): Promise<{ id: string }> {
		const response = await fetch(`${endpoint}${path}`, {
			method,
			headers:
				body === undefined ? undefined : { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok)
			throw new Error("Context sync failed. Your notes are retained.");
		return response.json();
	}
	return {
		create: (workspace, input, requestId) =>
			request("", "POST", { workspace, input, requestId }),
		update: (workspace, id, note) =>
			request(`/${encodeURIComponent(id)}`, "PATCH", { workspace, note }),
		save: (workspace, id) =>
			request(`/${encodeURIComponent(id)}/save`, "POST", { workspace }),
		remove: (workspace, id) =>
			request(
				`/${encodeURIComponent(id)}?workspace=${encodeURIComponent(workspace)}`,
				"DELETE",
			),
	};
}

function imageBlob(base64: string, mimeType: string): Blob {
	const binary = atob(base64);
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	return new Blob([bytes], { type: mimeType });
}

/** Save frozen images as local files before a text-only paste consumes the prompt. */
export async function exportAnnotationImageFiles(
	payload: AnnotationSendPayload,
): Promise<ReadonlyMap<string, string>> {
	const context = payload.retainedContext;
	if (!context || context.ids.length !== payload.images.length)
		throw new Error("Image export is unavailable. Your comments are retained.");
	const response = await fetch(simEndpoint("context/export-images"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ workspace: context.workspace, ids: context.ids }),
		signal: AbortSignal.timeout(15000),
	});
	if (!response.ok)
		throw new Error(
			"Image export failed. Try Copy prompt again. Your comments are retained.",
		);
	const files: unknown = await response.json();
	if (!Array.isArray(files) || files.length !== payload.images.length)
		throw new Error("Image export is incomplete. Your comments are retained.");
	return new Map(
		payload.images.map((image, index) => {
			const file = files[index];
			if (
				!file ||
				file.id !== context.ids[index] ||
				typeof file.path !== "string" ||
				!file.path.startsWith("/") ||
				file.width !== image.width ||
				file.height !== image.height ||
				file.mimeType !== image.mimeType
			)
				throw new Error(
					"Image export is incomplete. Your comments are retained.",
				);
			return [image.id, file.path];
		}),
	);
}

async function clipboardImage(payload: AnnotationSendPayload): Promise<Blob> {
	if (
		payload.images.length === 1 &&
		payload.images[0]!.mimeType === "image/png"
	)
		return imageBlob(payload.images[0]!.base64, "image/png");
	const images = await Promise.all(
		payload.images.map(async (entry) => {
			const bitmap = await createImageBitmap(
				imageBlob(entry.base64, entry.mimeType),
			);
			return bitmap;
		}),
	);
	try {
		const columns = Math.ceil(Math.sqrt(images.length));
		const cellWidth = Math.max(...images.map((entry) => entry.width));
		const cellHeight = Math.max(...images.map((entry) => entry.height)) + 32;
		const rows = Math.ceil(images.length / columns);
		const scale = Math.min(
			1,
			8192 / (columns * cellWidth),
			8192 / (rows * cellHeight),
		);
		const canvas = document.createElement("canvas");
		canvas.width = Math.ceil(columns * cellWidth * scale);
		canvas.height = Math.ceil(rows * cellHeight * scale);
		const context = canvas.getContext("2d");
		if (!context) throw new Error("Clipboard image is unavailable.");
		context.scale(scale, scale);
		context.fillStyle = "#ffffff";
		context.fillRect(0, 0, columns * cellWidth, rows * cellHeight);
		images.forEach((entry, index) => {
			const x = (index % columns) * cellWidth;
			const y = Math.floor(index / columns) * cellHeight;
			context.fillStyle = "#000000";
			context.font = "20px sans-serif";
			context.fillText(`${index + 1}`, x + 8, y + 24);
			context.drawImage(entry, x, y + 32);
		});
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob(
				(blob) =>
					blob
						? resolve(blob)
						: reject(new Error("Clipboard image is unavailable.")),
				"image/png",
			),
		);
	} finally {
		images.forEach((entry) => entry.close());
	}
}

/** One clipboard item includes text and every captured image, without a new capture. */
export async function copyAnnotationPayload(
	payload: AnnotationSendPayload,
): Promise<void> {
	if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
		throw new Error(
			"Clipboard access is unavailable. Your notes are retained.",
		);
	const escaped = payload.prompt.replace(
		/[&<>]/g,
		(character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[character]!,
	);
	const html = `<pre>${escaped}</pre>${payload.images.map((entry, index) => `<p>${index + 1}</p><img src="data:${entry.mimeType};base64,${entry.base64}" alt="Screenshot ${index + 1}">`).join("")}`;
	await navigator.clipboard.write([
		new ClipboardItem({
			"text/plain": new Blob([payload.prompt], { type: "text/plain" }),
			"text/html": new Blob([html], { type: "text/html" }),
			"image/png": clipboardImage(payload),
		}),
	]);
}
