import { decode as decodePng, encode as encodePng } from "fast-png";

/**
 * A timed observation returns one image, not a folder of them. The frames go
 * into a grid with an index in each cell, so a reader can name the frame that
 * shows the text and act on it.
 */
export const CONTACT_SHEET_MAX_WIDTH = 2048;
/** The sheet is read by a model, not printed. Height is capped like width. */
export const CONTACT_SHEET_MAX_HEIGHT = 2048;
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

export interface ContactSheetSource {
	index: number;
	bytes: Uint8Array;
	/** A frame the compositor cannot read gets a clear reason, not a guess. */
	mimeType?: string;
}

export interface ContactSheetCell {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ContactSheetGrid {
	columns: number;
	rows: number;
	cellWidth: number;
	cellHeight: number;
	width: number;
	height: number;
}

export interface ContactSheet extends ContactSheetGrid {
	bytes: Uint8Array;
	mimeType: "image/png";
	cells: ContactSheetCell[];
	warnings: string[];
}

interface RgbImage {
	width: number;
	height: number;
	data: Uint8Array;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function contactSheetGrid(
	count: number,
	frameWidth: number,
	frameHeight: number,
	maxWidth = CONTACT_SHEET_MAX_WIDTH,
): ContactSheetGrid {
	const frames = Math.max(1, Math.floor(count));
	const columns = Math.ceil(Math.sqrt(frames));
	const rows = Math.ceil(frames / columns);
	const gap = CONTACT_SHEET_SEPARATOR;
	const available = maxWidth - (columns + 1) * gap;
	const cellWidth = Math.max(
		1,
		Math.min(Math.max(1, frameWidth), Math.floor(available / columns)),
	);
	const cellHeight = Math.max(
		1,
		frameWidth > 0
			? Math.round((frameHeight * cellWidth) / frameWidth)
			: cellWidth,
	);
	return {
		columns,
		rows,
		cellWidth,
		cellHeight,
		width: columns * cellWidth + (columns + 1) * gap,
		height: rows * cellHeight + (rows + 1) * gap,
	};
}

export function contactSheetCells(grid: ContactSheetGrid, count: number): ContactSheetCell[] {
	const gap = CONTACT_SHEET_SEPARATOR;
	return Array.from({ length: count }, (_unused, position) => ({
		index: position,
		x: gap + (position % grid.columns) * (grid.cellWidth + gap),
		y: gap + Math.floor(position / grid.columns) * (grid.cellHeight + gap),
		width: grid.cellWidth,
		height: grid.cellHeight,
	}));
}

/** Screenshots arrive as grey, RGB, RGBA, or palette PNG. Level the shape. */
function toRgb(bytes: Uint8Array): RgbImage {
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

/** Nearest neighbour keeps the sheet cheap. Legibility comes from the size. */
function drawFrame(
	sheet: Uint8Array,
	sheetWidth: number,
	cell: ContactSheetCell,
	image: RgbImage,
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
 * readable over a light or a dark screen and never hides the status bar.
 */
function drawIndex(
	sheet: Uint8Array,
	sheetWidth: number,
	cell: ContactSheetCell,
	index: number,
): void {
	const glyph = Math.max(2, Math.floor(cell.width / 40));
	const text = String(Math.max(0, index));
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

export function buildContactSheet(
	sources: readonly ContactSheetSource[],
	maxWidth = CONTACT_SHEET_MAX_WIDTH,
): ContactSheet {
	if (sources.length === 0)
		throw new Error("A contact sheet needs at least one frame");
	const warnings: string[] = [];
	const decoded = sources.map((source) => {
		if (source.mimeType && source.mimeType !== "image/png") {
			warnings.push(
				`Frame ${source.index} is ${source.mimeType}. The contact sheet reads PNG only.`,
			);
			return { index: source.index, image: null };
		}
		try {
			return { index: source.index, image: toRgb(source.bytes) };
		} catch (error) {
			warnings.push(
				`Frame ${source.index} is not a readable PNG: ${messageOf(error)}`,
			);
			return { index: source.index, image: null };
		}
	});
	const first = decoded.find((entry) => entry.image !== null)?.image;
	if (!first)
		throw new Error("No frame in the contact sheet is a readable PNG");
	const grid = boundedGrid(sources.length, first.width, first.height, maxWidth);
	const sheet = new Uint8Array(grid.width * grid.height * 3).fill(
		SEPARATOR_LEVEL,
	);
	const cells = contactSheetCells(grid, sources.length).map((cell, position) => {
		const entry = decoded[position]!;
		if (entry.image) drawFrame(sheet, grid.width, cell, entry.image);
		drawIndex(sheet, grid.width, cell, entry.index);
		return { ...cell, index: entry.index };
	});
	return {
		...grid,
		bytes: encodePng(
			{ width: grid.width, height: grid.height, data: sheet, channels: 3, depth: 8 },
			{ zlib: SHEET_ZLIB },
		),
		mimeType: "image/png",
		cells,
		warnings,
	};
}

/** A grid no wider than maxWidth and no taller than CONTACT_SHEET_MAX_HEIGHT. */
function boundedGrid(
	count: number,
	frameWidth: number,
	frameHeight: number,
	maxWidth: number,
): ContactSheetGrid {
	const grid = contactSheetGrid(count, frameWidth, frameHeight, maxWidth);
	if (grid.height <= CONTACT_SHEET_MAX_HEIGHT) return grid;
	const narrower = Math.max(
		1,
		Math.floor((maxWidth * CONTACT_SHEET_MAX_HEIGHT) / grid.height),
	);
	return contactSheetGrid(count, frameWidth, frameHeight, narrower);
}

const yieldToEventLoop = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The same sheet as buildContactSheet, built in steps that return to the event
 * loop between frames so a live stream keeps moving while the sheet is made.
 */
export async function buildContactSheetAsync(
	sources: readonly ContactSheetSource[],
	maxWidth = CONTACT_SHEET_MAX_WIDTH,
): Promise<ContactSheet> {
	if (sources.length === 0)
		throw new Error("A contact sheet needs at least one frame");
	const warnings: string[] = [];
	const decoded: Array<{ index: number; image: RgbImage | null }> = [];
	for (const source of sources) {
		if (source.mimeType && source.mimeType !== "image/png") {
			warnings.push(
				`Frame ${source.index} is ${source.mimeType}. The contact sheet reads PNG only.`,
			);
			decoded.push({ index: source.index, image: null });
		} else {
			try {
				decoded.push({ index: source.index, image: toRgb(source.bytes) });
			} catch (error) {
				warnings.push(
					`Frame ${source.index} is not a readable PNG: ${messageOf(error)}`,
				);
				decoded.push({ index: source.index, image: null });
			}
		}
		await yieldToEventLoop();
	}
	const first = decoded.find((entry) => entry.image !== null)?.image;
	if (!first)
		throw new Error("No frame in the contact sheet is a readable PNG");
	const grid = boundedGrid(sources.length, first.width, first.height, maxWidth);
	const sheet = new Uint8Array(grid.width * grid.height * 3).fill(
		SEPARATOR_LEVEL,
	);
	const cells: ContactSheet["cells"] = [];
	for (const [position, cell] of contactSheetCells(grid, sources.length).entries()) {
		const entry = decoded[position]!;
		if (entry.image) drawFrame(sheet, grid.width, cell, entry.image);
		drawIndex(sheet, grid.width, cell, entry.index);
		cells.push({ ...cell, index: entry.index });
		await yieldToEventLoop();
	}
	return {
		...grid,
		bytes: encodePng(
			{ width: grid.width, height: grid.height, data: sheet, channels: 3, depth: 8 },
			{ zlib: SHEET_ZLIB },
		),
		mimeType: "image/png",
		cells,
		warnings,
	};
}
