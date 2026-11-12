import { simEndpoint } from "../preview/sim-endpoint";
import { annotationClipboardCaptures } from "./clipboard-image";
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

const MARKER = "#ff3b30";

/** Draw at copy time. The frozen evidence image never changes. */
export async function annotatedClipboardImage(
	payload: AnnotationSendPayload,
): Promise<Blob> {
	const captures = annotationClipboardCaptures(payload);
	if (!captures.length) throw new Error("Clipboard image is unavailable.");
	const bitmaps = await Promise.all(
		captures.map((capture) =>
			createImageBitmap(
				imageBlob(capture.image.base64, capture.image.mimeType),
			),
		),
	);
	try {
		const labelled = captures.length > 1;
		const header = labelled ? 48 : 0;
		const columns = Math.ceil(Math.sqrt(bitmaps.length));
		const rows = Math.ceil(bitmaps.length / columns);
		const cellWidth = Math.max(...bitmaps.map((entry) => entry.width));
		const cellHeight = Math.max(...bitmaps.map((entry) => entry.height)) + header;
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
		captures.forEach((capture, index) => {
			const bitmap = bitmaps[index]!;
			const x = (index % columns) * cellWidth;
			const y = Math.floor(index / columns) * cellHeight + header;
			if (labelled) {
				context.fillStyle = "#000000";
				context.font = "600 28px sans-serif";
				context.textBaseline = "middle";
				context.textAlign = "left";
				context.fillText(`Image ${capture.number}`, x + 8, y - header / 2);
			}
			context.drawImage(bitmap, x, y);
			const line = Math.max(3, bitmap.width / 250);
			const radius = Math.max(14, bitmap.width / 40);
			context.strokeStyle = MARKER;
			context.lineWidth = line;
			for (const marker of capture.markers)
				context.strokeRect(
					x + marker.rect.x,
					y + marker.rect.y,
					marker.rect.width,
					marker.rect.height,
				);
			for (const marker of capture.markers) {
				const cx = x + Math.min(Math.max(marker.rect.x, radius), bitmap.width - radius);
				const cy = y + Math.min(Math.max(marker.rect.y, radius), bitmap.height - radius);
				context.beginPath();
				context.arc(cx, cy, radius, 0, Math.PI * 2);
				context.fillStyle = MARKER;
				context.fill();
				context.fillStyle = "#ffffff";
				context.font = `700 ${Math.round(radius * 1.1)}px sans-serif`;
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.fillText(String(marker.number), cx, cy);
			}
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
		bitmaps.forEach((entry) => entry.close());
	}
}

type Payload = AnnotationSendPayload | Promise<AnnotationSendPayload>;

/**
 * Plain text and one PNG. No HTML flavor: chat composers take HTML first and
 * drop data-URI images, so the image would never attach.
 */
export function annotationClipboardFlavors(
	payload: Payload,
	image: (payload: AnnotationSendPayload) => Promise<Blob> = annotatedClipboardImage,
): Record<"text/plain" | "image/png", Promise<Blob>> {
	const ready = Promise.resolve(payload);
	return {
		"text/plain": ready.then(
			(value) => new Blob([value.prompt], { type: "text/plain" }),
		),
		"image/png": ready.then(image),
	};
}

function clipboard() {
	if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined")
		throw new Error(
			"Clipboard access is unavailable. Your notes are retained.",
		);
	return navigator.clipboard;
}

/**
 * Call this directly in the click handler. The write starts before any await,
 * so the browser keeps the user activation while the payload is prepared.
 */
export function copyAnnotationPayload(payload: Payload): Promise<void> {
	try {
		return clipboard().write([
			new ClipboardItem(annotationClipboardFlavors(payload)),
		]);
	} catch (error) {
		return Promise.reject(error);
	}
}

/** Only the marked PNG, for apps that read one clipboard flavor. */
export function copyAnnotationImage(payload: AnnotationSendPayload): Promise<void> {
	try {
		return clipboard().write([
			new ClipboardItem({ "image/png": annotatedClipboardImage(payload) }),
		]);
	} catch (error) {
		return Promise.reject(error);
	}
}
