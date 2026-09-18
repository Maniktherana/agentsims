import { decode as decodePng, encode as encodePng } from "fast-png";

/**
 * A timed observation returns sheets of frames, not a folder of images. The
 * frames go into a grid with an index in each cell, so a reader can name the
 * frame that shows the text and act on it.
 *
 * Legibility comes first. A cell is never narrower than the frame allows, so
 * a sheet holds only the frames that fit. The rest go on the next sheet.
 */
export const CONTACT_SHEET_MAX_WIDTH = 2048;
/** The sheet is read by a model, not printed. Height is bounded like width. */
export const CONTACT_SHEET_MAX_HEIGHT = 2048;
/** A cell this wide keeps phone text readable. A smaller frame keeps its size. */
export const CONTACT_SHEET_MAX_CELL_WIDTH = 640;
/** Fast deflate: the sheet is transient evidence, not an archive. */
const SHEET_ZLIB = { level: 1 } as const;
export const CONTACT_SHEET_SEPARATOR = 4;

const SEPARATOR_LEVEL = 32;
const BADGE_LEVEL = 0;
const DIGIT_LEVEL = 255;
const DIGIT_WIDTH = 3;
const DIGIT_HEIGHT = 5;

/** A 3x5 bitmap per digit. The sheet must stay readable without a font file. */
const DIGITS: readonly (readonly string[])[] = [
	["###", "#.#", "#.#", "#.#", "###"],
	[".#.", "##.", ".#.", ".#.", "###"],
	["###", "..#", "###", "#..", "###"],
	["###", "..#", "###", "..#", "###"],
	["#.#", "#.#", "###", "..#", "..#"],
	["###", "#..", "###", "..#", "###"],
	["###", "#..", "###", "#.#", "###"],
	["###", "..#", "..#", "..#", "..#"],
	["###", "#.#", "###", "#.#", "###"],
	["###", "#.#", "###", "..#", "###"],
];

/** A box in screenshot pixels. */
export interface FrameRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Packed 8-bit RGB. Every frame reaches the compositor in this shape. */
export interface FrameImage {
	width: number;
	height: number;
	data: Uint8Array;
}

export interface ContactSheetSource {
	index: number;
	/** An encoded frame. The compositor reads PNG only. */
	bytes?: Uint8Array;
	/** A frame the compositor cannot read gets a clear reason, not a guess. */
	mimeType?: string;
	/** A frame the sampler already decoded, cropped, or scaled. */
	image?: FrameImage;
}

export interface ContactSheetCell {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The layout one frame size implies, and how many frames a sheet holds. */
export interface ContactSheetGrid {
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
	perSheet: number;
}

export interface ContactSheetPage {
	index: number;
	frames: number[];
	bytes: Uint8Array;
	mimeType: "image/png";
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
	width: number;
	height: number;
	cells: ContactSheetCell[];
}

export interface ContactSheets {
	sheets: ContactSheetPage[];
	grid: ContactSheetGrid;
	warnings: string[];
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Cells are sized for reading, then as many as fit go on one sheet. A 1080
 * wide frame scales to 640. A 500 wide crop keeps its own width.
 */
export function frameSheetGrid(
	frameWidth: number,
	frameHeight: number,
	maxWidth = CONTACT_SHEET_MAX_WIDTH,
	maxHeight = CONTACT_SHEET_MAX_HEIGHT,
	maxCellWidth = CONTACT_SHEET_MAX_CELL_WIDTH,
): ContactSheetGrid {
	const width = Math.max(1, Math.floor(frameWidth));
	const height = Math.max(1, Math.floor(frameHeight));
	const cellWidth = Math.max(1, Math.min(width, maxCellWidth));
	const cellHeight = Math.max(1, Math.round((height * cellWidth) / width));
	const gap = CONTACT_SHEET_SEPARATOR;
	const columns = Math.max(1, Math.floor((maxWidth + gap) / (cellWidth + gap)));
	const rows = Math.max(1, Math.floor((maxHeight + gap) / (cellHeight + gap)));
	return { columns, rows, cellWidth, cellHeight, perSheet: columns * rows };
}

export function contactSheetCells(
	columns: number,
	cellWidth: number,
	cellHeight: number,
	count: number,
): ContactSheetCell[] {
	const gap = CONTACT_SHEET_SEPARATOR;
	return Array.from({ length: count }, (_unused, position) => ({
		index: position,
		x: gap + (position % columns) * (cellWidth + gap),
		y: gap + Math.floor(position / columns) * (cellHeight + gap),
		width: cellWidth,
		height: cellHeight,
	}));
}

/** Screenshots arrive as grey, RGB, RGBA, or palette PNG. Level the shape. */
export function decodeFrameImage(bytes: Uint8Array): FrameImage {
	const decoded = decodePng(bytes);
	const source = decoded.data;
	const palette = decoded.palette;
	const shift = decoded.depth === 16 ? 8 : 0;
	const channels = decoded.channels;
	const pixels = decoded.width * decoded.height;
	const data = new Uint8Array(pixels * 3);
	for (let pixel = 0; pixel < pixels; pixel += 1) {
		const from = pixel * channels;
		const to = pixel * 3;
		if (palette) {
			const entry = palette[Number(source[from] ?? 0)] ?? [0, 0, 0];
			data[to] = entry[0] ?? 0;
			data[to + 1] = entry[1] ?? 0;
			data[to + 2] = entry[2] ?? 0;
			continue;
		}
		const red = Number(source[from] ?? 0) >> shift;
		if (channels >= 3) {
			data[to] = red;
			data[to + 1] = Number(source[from + 1] ?? 0) >> shift;
			data[to + 2] = Number(source[from + 2] ?? 0) >> shift;
			continue;
		}
		data[to] = red;
		data[to + 1] = red;
		data[to + 2] = red;
	}
	return { width: decoded.width, height: decoded.height, data };
}

/** The live buffer hands out RGBA. The sheet and the PNG want RGB. */
export function rgbaFrameImage(
	rgba: Uint8Array,
	width: number,
	height: number,
): FrameImage {
	const pixels = Math.max(0, Math.floor(width * height));
	const data = new Uint8Array(pixels * 3);
	for (let pixel = 0; pixel < pixels; pixel += 1) {
		const from = pixel * 4;
		const to = pixel * 3;
		data[to] = rgba[from] ?? 0;
		data[to + 1] = rgba[from + 1] ?? 0;
		data[to + 2] = rgba[from + 2] ?? 0;
	}
	return { width, height, data };
}

export function encodeFramePng(image: FrameImage): Uint8Array {
	return encodePng(
		{
			width: image.width,
			height: image.height,
			data: image.data,
			channels: 3,
			depth: 8,
		},
		{ zlib: SHEET_ZLIB },
	);
}

/** A region the frame cannot hold is cut down to the part that it can. */
export function clampFrameRegion(
	region: FrameRegion,
	width: number,
	height: number,
): FrameRegion | null {
	const x = Math.max(0, Math.min(Math.round(region.x), width));
	const y = Math.max(0, Math.min(Math.round(region.y), height));
	const right = Math.max(x, Math.min(Math.round(region.x + region.width), width));
	const bottom = Math.max(
		y,
		Math.min(Math.round(region.y + region.height), height),
	);
	if (right - x < 1 || bottom - y < 1) return null;
	return { x, y, width: right - x, height: bottom - y };
}

export function cropFrameImage(
	image: FrameImage,
	region: FrameRegion,
): FrameImage {
	const data = new Uint8Array(region.width * region.height * 3);
	for (let row = 0; row < region.height; row += 1) {
		const from = ((region.y + row) * image.width + region.x) * 3;
		data.set(
			image.data.subarray(from, from + region.width * 3),
			row * region.width * 3,
		);
	}
	return { width: region.width, height: region.height, data };
}

/** Nearest neighbour keeps the sheet cheap. Legibility comes from the size. */
export function scaleFrameImage(
	image: FrameImage,
	width: number,
	height: number,
): FrameImage {
	if (image.width === width && image.height === height) return image;
	const data = new Uint8Array(Math.max(1, width * height * 3));
	for (let y = 0; y < height; y += 1) {
		const sourceY = Math.min(
			image.height - 1,
			Math.floor((y * image.height) / height),
		);
		for (let x = 0; x < width; x += 1) {
			const sourceX = Math.min(
				image.width - 1,
				Math.floor((x * image.width) / width),
			);
			const from = (sourceY * image.width + sourceX) * 3;
			const to = (y * width + x) * 3;
			data[to] = image.data[from] ?? 0;
			data[to + 1] = image.data[from + 1] ?? 0;
			data[to + 2] = image.data[from + 2] ?? 0;
		}
	}
	return { width, height, data };
}

function fillRect(
	sheet: Uint8Array,
	sheetWidth: number,
	x: number,
	y: number,
	width: number,
	height: number,
	level: number,
): void {
	for (let row = 0; row < height; row += 1) {
		const start = ((y + row) * sheetWidth + x) * 3;
		sheet.fill(level, start, start + width * 3);
	}
}

function drawFrame(
	sheet: Uint8Array,
	sheetWidth: number,
	cell: ContactSheetCell,
	image: FrameImage,
): void {
	for (let y = 0; y < cell.height; y += 1) {
		const sourceY = Math.min(
			image.height - 1,
			Math.floor((y * image.height) / cell.height),
		);
		for (let x = 0; x < cell.width; x += 1) {
			const sourceX = Math.min(
				image.width - 1,
				Math.floor((x * image.width) / cell.width),
			);
			const from = (sourceY * image.width + sourceX) * 3;
			const to = ((cell.y + y) * sheetWidth + cell.x + x) * 3;
			sheet[to] = image.data[from] ?? 0;
			sheet[to + 1] = image.data[from + 1] ?? 0;
			sheet[to + 2] = image.data[from + 2] ?? 0;
		}
	}
}

/**
 * The index sits in the bottom-left corner on a solid box, so it stays
 * readable over a light or a dark screen and never hides the status bar. The
 * index is global over every sheet, so it can carry two or three digits.
 */
function drawIndex(
	sheet: Uint8Array,
	sheetWidth: number,
	cell: ContactSheetCell,
	index: number,
): void {
	const text = String(Math.max(0, Math.floor(index)));
	const glyph = Math.max(
		2,
		Math.min(
			Math.floor(cell.width / 40),
			// Many digits must not push the badge out of its cell.
			Math.floor(cell.width / (2 + text.length * (DIGIT_WIDTH + 1))),
		),
	);
	const textWidth = (text.length * DIGIT_WIDTH + text.length - 1) * glyph;
	const boxWidth = Math.min(cell.width, textWidth + 2 * glyph);
	const boxHeight = Math.min(cell.height, (DIGIT_HEIGHT + 2) * glyph);
	const boxY = cell.y + cell.height - boxHeight;
	fillRect(sheet, sheetWidth, cell.x, boxY, boxWidth, boxHeight, BADGE_LEVEL);
	let originX = cell.x + glyph;
	const originY = boxY + glyph;
	for (const character of text) {
		const bitmap = DIGITS[Number(character)];
		if (!bitmap) continue;
		for (let row = 0; row < DIGIT_HEIGHT; row += 1) {
			for (let column = 0; column < DIGIT_WIDTH; column += 1) {
				if (bitmap[row]?.[column] !== "#") continue;
				fillRect(
					sheet,
					sheetWidth,
					originX + column * glyph,
					originY + row * glyph,
					glyph,
					glyph,
					DIGIT_LEVEL,
				);
			}
		}
		originX += (DIGIT_WIDTH + 1) * glyph;
	}
}

const yieldToEventLoop = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

type DecodedFrame = { index: number; image: FrameImage | null };

function decodeSource(
	source: ContactSheetSource,
	warnings: string[],
): DecodedFrame {
	if (source.image) return { index: source.index, image: source.image };
	if (source.mimeType && source.mimeType !== "image/png") {
		warnings.push(
			`Frame ${source.index} is ${source.mimeType}. The contact sheet reads PNG only.`,
		);
		return { index: source.index, image: null };
	}
	try {
		return { index: source.index, image: decodeFrameImage(source.bytes!) };
	} catch (error) {
		warnings.push(
			`Frame ${source.index} is not a readable PNG: ${messageOf(error)}`,
		);
		return { index: source.index, image: null };
	}
}

function composeSheet(
	page: number,
	frames: readonly DecodedFrame[],
	grid: ContactSheetGrid,
): ContactSheetPage {
	const gap = CONTACT_SHEET_SEPARATOR;
	const columns = Math.max(1, Math.min(grid.columns, frames.length));
	const rows = Math.max(1, Math.ceil(frames.length / columns));
	const width = columns * grid.cellWidth + (columns + 1) * gap;
	const height = rows * grid.cellHeight + (rows + 1) * gap;
	const sheet = new Uint8Array(width * height * 3).fill(SEPARATOR_LEVEL);
	const cells = contactSheetCells(
		columns,
		grid.cellWidth,
		grid.cellHeight,
		frames.length,
	).map((cell, position) => {
		const entry = frames[position]!;
		if (entry.image) drawFrame(sheet, width, cell, entry.image);
		drawIndex(sheet, width, cell, entry.index);
		return { ...cell, index: entry.index };
	});
	return {
		index: page,
		frames: frames.map((frame) => frame.index),
		bytes: encodeFramePng({ width, height, data: sheet }),
		mimeType: "image/png",
		columns,
		rows,
		cellWidth: grid.cellWidth,
		cellHeight: grid.cellHeight,
		width,
		height,
		cells,
	};
}

/**
 * As many sheets as the frames need, built in steps that return to the event
 * loop between frames so a live stream keeps moving while the sheets are made.
 */
export async function buildContactSheetsAsync(
	sources: readonly ContactSheetSource[],
	maxWidth = CONTACT_SHEET_MAX_WIDTH,
	maxHeight = CONTACT_SHEET_MAX_HEIGHT,
): Promise<ContactSheets> {
	if (sources.length === 0)
		throw new Error("A contact sheet needs at least one frame");
	const warnings: string[] = [];
	const decoded: DecodedFrame[] = [];
	for (const source of sources) {
		decoded.push(decodeSource(source, warnings));
		await yieldToEventLoop();
	}
	const first = decoded.find((entry) => entry.image !== null)?.image;
	if (!first)
		throw new Error("No frame in the contact sheet is a readable PNG");
	const grid = frameSheetGrid(first.width, first.height, maxWidth, maxHeight);
	const sheets: ContactSheetPage[] = [];
	for (let start = 0; start < decoded.length; start += grid.perSheet) {
		sheets.push(
			composeSheet(
				sheets.length,
				decoded.slice(start, start + grid.perSheet),
				grid,
			),
		);
		await yieldToEventLoop();
	}
	return { sheets, grid, warnings };
}
