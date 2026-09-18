import { describe, expect, test } from "bun:test";
import { decode as decodePng, encode as encodePng } from "fast-png";
import {
	buildContactSheet,
	contactSheetGrid,
	CONTACT_SHEET_SEPARATOR,
} from "../../../../../core/tools/observe/contact-sheet";

const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 2400;

/** A solid frame per index, so a cell's colour names the frame it holds. */
function solidFrame(
	index: number,
	width = FRAME_WIDTH,
	height = FRAME_HEIGHT,
): Uint8Array {
	const colour = [20 + index * 10, 60 + index * 5, 200 - index * 12];
	const data = new Uint8Array(width * height * 3);
	for (let pixel = 0; pixel < width * height; pixel += 1) {
		data[pixel * 3] = colour[0]!;
		data[pixel * 3 + 1] = colour[1]!;
		data[pixel * 3 + 2] = colour[2]!;
	}
	return encodePng({ width, height, data, channels: 3, depth: 8 });
}

function frameColour(index: number): [number, number, number] {
	return [20 + index * 10, 60 + index * 5, 200 - index * 12];
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

describe("contact sheet", () => {
	test("lays 8 portrait frames into a bounded grid", () => {
		const grid = contactSheetGrid(8, FRAME_WIDTH, FRAME_HEIGHT);

		expect(grid).toEqual({
			columns: 3,
			rows: 3,
			cellWidth: 677,
			cellHeight: 1504,
			width: 2047,
			height: 4528,
		});
		expect(grid.width).toBeLessThanOrEqual(2048);
	});

	test("puts each frame in its own cell and writes the frame index", () => {
		const sources = Array.from({ length: 8 }, (_unused, index) => ({
			index,
			bytes: solidFrame(index),
		}));

		const sheet = buildContactSheet(sources);
		const image = sheetReader(sheet.bytes);

		expect(sheet.warnings).toEqual([]);
		expect({
			columns: sheet.columns,
			rows: sheet.rows,
			cellWidth: sheet.cellWidth,
			cellHeight: sheet.cellHeight,
			width: sheet.width,
			height: sheet.height,
		}).toEqual({
			columns: 3,
			rows: 3,
			cellWidth: 303,
			cellHeight: 673,
			width: 925,
			height: 2035,
		});
		// Height is capped like width, so eight portrait frames shrink to fit.
		expect(image.width).toBe(925);
		expect(image.height).toBe(2035);

		const gap = CONTACT_SHEET_SEPARATOR;
		const first = sheet.cells[0]!;
		const last = sheet.cells[7]!;
		expect({ x: first.x, y: first.y }).toEqual({ x: gap, y: gap });
		expect({ x: last.x, y: last.y }).toEqual({
			x: gap + (sheet.cellWidth + gap),
			y: gap + 2 * (sheet.cellHeight + gap),
		});
		// The top-left pixel of a cell is the top-left pixel of its frame.
		expect(image.at(first.x, first.y)).toEqual(frameColour(0));
		expect(image.at(last.x, last.y)).toEqual(frameColour(7));
		// The separator keeps the cells apart.
		expect(image.at(first.x + sheet.cellWidth + 1, first.y)).toEqual([
			32, 32, 32,
		]);

		// "7" is "###" over four rows of "..#". Its box sits bottom-left.
		const glyph = Math.floor(sheet.cellWidth / 40);
		const originX = last.x + glyph;
		const originY = last.y + last.height - (5 + 2) * glyph + glyph;
		expect(glyph).toBe(7);
		expect(image.at(originX, originY)).toEqual([255, 255, 255]);
		expect(image.at(originX + 2 * glyph, originY)).toEqual([255, 255, 255]);
		expect(image.at(originX, originY + 2 * glyph)).toEqual([0, 0, 0]);
		expect(image.at(originX + 2 * glyph, originY + 2 * glyph)).toEqual([
			255, 255, 255,
		]);
	});

	test("reports an unreadable frame and keeps the rest of the sheet", () => {
		const sheet = buildContactSheet([
			{ index: 0, bytes: solidFrame(0, 40, 80) },
			{ index: 1, bytes: new Uint8Array([1, 2, 3]) },
		]);
		const image = sheetReader(sheet.bytes);

		expect(sheet.warnings).toHaveLength(1);
		expect(sheet.warnings[0]).toContain("Frame 1 is not a readable PNG");
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

	test("names the format of a frame it cannot read", () => {
		const sheet = buildContactSheet([
			{ index: 0, bytes: solidFrame(0, 40, 80), mimeType: "image/png" },
			{ index: 1, bytes: Buffer.from([0xff, 0xd8]), mimeType: "image/jpeg" },
		]);

		expect(sheet.warnings).toEqual([
			"Frame 1 is image/jpeg. The contact sheet reads PNG only.",
		]);
		expect(sheet.columns).toBe(2);
	});

	test("refuses a sheet without any frame", () => {
		expect(() => buildContactSheet([])).toThrow(
			"A contact sheet needs at least one frame",
		);
		expect(() =>
			buildContactSheet([{ index: 0, bytes: new Uint8Array([9]) }]),
		).toThrow("No frame in the contact sheet is a readable PNG");
	});
});
