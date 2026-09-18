import { decode as decodePng } from "fast-png";

export type SessionScreenshot = {
	bytes: Buffer;
	mimeType: string;
	capturedAt: number;
};

export type CapturedImage = {
	bytes: Buffer;
	mimeType: string;
	width: number;
	height: number;
};

function pngImage(bytes: Buffer): Omit<CapturedImage, "bytes" | "mimeType"> {
	try {
		const decoded = decodePng(bytes, { checkCrc: true });
		return {
			width: decoded.width,
			height: decoded.height,
		};
	} catch {
		throw new Error("The PNG screenshot is invalid");
	}
}

const JPEG_SIZE_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
	0xcf,
]);

function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 3 < bytes.length) {
		while (bytes[offset] === 0xff) offset += 1;
		const marker = bytes[offset];
		if (marker === undefined || marker === 0xd9 || marker === 0xda) return null;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			offset += 1;
			continue;
		}
		if (offset + 2 >= bytes.length) return null;
		const length = bytes.readUInt16BE(offset + 1);
		if (length < 2 || offset + 1 + length > bytes.length) return null;
		if (JPEG_SIZE_MARKERS.has(marker)) {
			if (length < 7) return null;
			const height = bytes.readUInt16BE(offset + 4);
			const width = bytes.readUInt16BE(offset + 6);
			return width > 0 && height > 0 ? { width, height } : null;
		}
		offset += length + 1;
	}
	return null;
}

export function capturedImage(screenshot: SessionScreenshot): CapturedImage {
	if (screenshot.mimeType === "image/png") {
		return {
			bytes: screenshot.bytes,
			mimeType: screenshot.mimeType,
			...pngImage(screenshot.bytes),
		};
	}
	if (screenshot.mimeType !== "image/jpeg")
		throw new Error(
			`The ${screenshot.mimeType || "unknown"} screenshot format is not supported`,
		);
	const dimensions = jpegDimensions(screenshot.bytes);
	if (!dimensions)
		throw new Error(
			`The ${screenshot.mimeType || "unknown"} screenshot has no valid dimensions`,
		);
	return {
		bytes: screenshot.bytes,
		mimeType: screenshot.mimeType,
		...dimensions,
	};
}
