import { describe, expect, test } from "bun:test";
import { decode as decodePng, encode as encodePng } from "fast-png";
import {
	buildContactSheetsAsync,
	frameSheetGrid,
	rgbaFrameImage,
	CONTACT_SHEET_SEPARATOR,
	badgeGlyphSize,
} from "../../../../../core/tools/observe/contact-sheet";

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 2400;

function frameColour(index: number): [number, number, number] {
	return [20 + index * 10, 60 + index * 5, 200 - index * 12];
}

/** A solid frame per index, so a cell's colour names the frame it holds. */
function solidFrame(
	index: number,
	width = FRAME_WIDTH,
	height = FRAME_HEIGHT,
): Uint8Array {
	const colour = frameColour(index);
	const data = new Uint8Array(width * height * 3);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		data[pixel * 3] = colour[0];
		data[pixel * 3 + 1] = colour[1];
		data[pixel * 3 + 2] = colour[2];
	}
	return encodePng({ width, height, data, channels: 3, depth: 8 });
}

function sources(count: number, width?: number, height?: number) {
	return Array.from({ length: count }, (_unused, index) => ({
		index,
		bytes: solidFrame(index, width, height),
	}));
}

function sheetReader(bytes: Uint8Array) {
	const decoded = decodePng(bytes);
	const data = decoded.data as Uint8Array;
	return {
		width: decoded.width,
		height: decoded.height,
		at: (x: number, y: number): [number, number, number] => {
			const from = (y * decoded.width + x) * 3;
			return [data[from]!, data[from + 1]!, data[from + 2]!];
		},
	};
}

describe("contact sheet layout", () => {
	test("sizes a portrait cell for reading and pages the rest", () => {
		expect(frameSheetGrid(FRAME_WIDTH, FRAME_HEIGHT)).toEqual({
			columns: 3,
			rows: 1,
			cellWidth: 640,
			cellHeight: 1422,
			perSheet: 3,
		});
	});

	test("keeps a small crop at its own size and fits many of them", () => {
		expect(frameSheetGrid(500, 300)).toEqual({
			columns: 4,
			rows: 6,
			cellWidth: 500,
			cellHeight: 300,
			perSheet: 24,
		});
	});
});

describe("contact sheets", () => {
	test("pages ten portrait frames into four sheets with global indexes", async () => {
		const built = await buildContactSheetsAsync(sources(10));

		expect(built.warnings).toEqual([]);
		expect(built.sheets).toHaveLength(4);
		expect(built.sheets.map((sheet) => sheet.frames)).toEqual([
			[0, 1, 2],
			[3, 4, 5],
			[6, 7, 8],
			[9],
		]);
		expect(built.sheets.map((sheet) => sheet.index)).toEqual([0, 1, 2, 3]);
		for (const sheet of built.sheets) {
			expect(sheet.cellWidth).toBe(640);
			expect(sheet.cellHeight).toBe(1422);
			expect(sheet.rows).toBe(1);
		}
		expect(built.sheets[0]!.columns).toBe(3);
		// The last sheet holds one frame, so it is one cell wide.
		expect(built.sheets[3]!.columns).toBe(1);

		const gap = CONTACT_SHEET_SEPARATOR;
		const second = built.sheets[1]!;
		const image = sheetReader(second.bytes);
		expect(image.width).toBe(second.width);
		expect(image.height).toBe(second.height);
		expect(second.width).toBe(3 * 640 + 4 * gap);
		// Sheet two opens with frame 3, not with frame 0.
		expect(second.cells.map((cell) => cell.index)).toEqual([3, 4, 5]);
		expect(image.at(second.cells[0]!.x, second.cells[0]!.y)).toEqual(
			frameColour(3),
		);
		expect(image.at(second.cells[2]!.x, second.cells[2]!.y)).toEqual(
			frameColour(5),
		);
		expect(image.at(second.cells[0]!.x + 640 + 1, gap)).toEqual([32, 32, 32]);
	});

	test("fits ten cropped frames on one sheet of four columns", async () => {
		const built = await buildContactSheetsAsync(sources(10, 500, 300));

		expect(built.sheets).toHaveLength(1);
		expect(built.grid).toMatchObject({ columns: 4, rows: 6, perSheet: 24 });
		expect(built.sheets[0]).toMatchObject({
			columns: 4,
			rows: 3,
			cellWidth: 500,
			cellHeight: 300,
		});
		expect(built.sheets[0]!.frames).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	test("draws a two-digit badge as two glyphs", async () => {
		const frames = Array.from({ length: 13 }, (_unused, index) => ({
			index,
			bytes: solidFrame(0, 200, 200),
		}));

		const built = await buildContactSheetsAsync(frames);
		const sheet = built.sheets[0]!;
		const cell = sheet.cells.find((entry) => entry.index === 12)!;
		const image = sheetReader(sheet.bytes);
		const glyph = badgeGlyphSize(cell.width, 2);
		const originX = cell.x + glyph;
		const originY = cell.y + cell.height - 7 * glyph + glyph;
		// "1" is a single bar and "2" opens with a full row, so the badge shows
		// two glyphs side by side and not one.
		expect(image.at(originX + glyph, originY)).toEqual([255, 255, 255]);
		expect(image.at(originX, originY)).toEqual([0, 0, 0]);
		const second = originX + 4 * glyph;
		expect(image.at(second, originY)).toEqual([255, 255, 255]);
		expect(image.at(second + 2 * glyph, originY)).toEqual([255, 255, 255]);
		expect(image.at(second, originY + 2 * glyph)).toEqual([255, 255, 255]);
	});

	test("reports an unreadable frame and keeps the rest of the sheet", async () => {
		const built = await buildContactSheetsAsync([
			{ index: 0, bytes: solidFrame(0, 40, 80) },
			{ index: 1, bytes: new Uint8Array([1, 2, 3]) },
		]);
		const sheet = built.sheets[0]!;
		const image = sheetReader(sheet.bytes);

		expect(built.warnings).toHaveLength(1);
		expect(built.warnings[0]).toContain("Frame 1 is not a readable PNG");
		expect(sheet.columns).toBe(2);
		expect(sheet.rows).toBe(1);
		expect(image.at(sheet.cells[0]!.x, sheet.cells[0]!.y)).toEqual(
			frameColour(0),
		);
		// A missing frame leaves the separator colour behind its index box.
		expect(image.at(sheet.cells[1]!.x, sheet.cells[1]!.y)).toEqual([
			32, 32, 32,
		]);
	});

	test("names the format of a frame it cannot read", async () => {
		const built = await buildContactSheetsAsync([
			{ index: 0, bytes: solidFrame(0, 40, 80), mimeType: "image/png" },
			{ index: 1, bytes: Buffer.from([0xff, 0xd8]), mimeType: "image/jpeg" },
		]);

		expect(built.warnings).toEqual([
			"Frame 1 is image/jpeg. The contact sheet reads PNG only.",
		]);
		expect(built.sheets[0]!.columns).toBe(2);
	});

	test("takes a decoded frame without asking for PNG bytes", async () => {
		const built = await buildContactSheetsAsync([
			{ index: 7, image: rgbaFrameImage(new Uint8Array(4 * 4 * 4).fill(90), 4, 4) },
		]);

		expect(built.warnings).toEqual([]);
		expect(built.sheets[0]!.frames).toEqual([7]);
		expect(built.sheets[0]!.cellWidth).toBe(4);
	});

	test("refuses a sheet without any frame", async () => {
		await expect(buildContactSheetsAsync([])).rejects.toThrow(
			"A contact sheet needs at least one frame",
		);
		await expect(
			buildContactSheetsAsync([{ index: 0, bytes: new Uint8Array([9]) }]),
		).rejects.toThrow("No frame in the contact sheet is a readable PNG");
	});
});

