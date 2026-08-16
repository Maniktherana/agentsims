export type RenderedScreenshot = {
	src: string;
	width: number;
	height: number;
	blob: Blob;
};

function dataUrlToBlob(dataUrl: string): Blob {
	const [header, encoded = ""] = dataUrl.split(",", 2);
	const mime = /data:([^;,]+)/.exec(header ?? "")?.[1] ?? "image/png";
	const binary = header?.includes(";base64")
		? atob(encoded)
		: decodeURIComponent(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new Blob([bytes], { type: mime });
}

export function captureRenderedScreenshot(
	source: HTMLCanvasElement | HTMLImageElement,
	rotationDegrees = 0,
): RenderedScreenshot | null {
	const sourceWidth =
		source instanceof HTMLCanvasElement ? source.width : source.naturalWidth;
	const sourceHeight =
		source instanceof HTMLCanvasElement ? source.height : source.naturalHeight;
	if (sourceWidth <= 0 || sourceHeight <= 0) return null;

	const normalizedRotation = ((rotationDegrees % 360) + 360) % 360;
	const sideways = normalizedRotation === 90 || normalizedRotation === 270;
	const width = sideways ? sourceHeight : sourceWidth;
	const height = sideways ? sourceWidth : sourceHeight;
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Unable to capture rendered screen");
	context.translate(width / 2, height / 2);
	context.rotate((normalizedRotation * Math.PI) / 180);
	context.drawImage(
		source,
		-sourceWidth / 2,
		-sourceHeight / 2,
		sourceWidth,
		sourceHeight,
	);
	const src = canvas.toDataURL("image/png");
	return { src, width, height, blob: dataUrlToBlob(src) };
}
