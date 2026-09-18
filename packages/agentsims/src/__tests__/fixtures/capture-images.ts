import { encode as encodePng } from "fast-png";

export function usablePng(width: number, height: number): Buffer {
	return Buffer.from(
		encodePng({
			width,
			height,
			depth: 1,
			channels: 1,
			palette: [
				[0, 0, 0],
				[1, 1, 1],
			],
			data: new Uint8Array(Math.ceil(width / 8) * height).fill(0xff),
		}),
	);
}
