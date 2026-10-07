import { open, stat, type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import { StringDecoder } from "node:string_decoder";

export interface LogFileFollowOptions {
	signal: AbortSignal;
	write(text: string): void | Promise<void>;
	initialLines?: number;
	chunkBytes?: number;
	pollMs?: number;
}

const missing = (error: unknown) =>
	(error as NodeJS.ErrnoException).code === "ENOENT";
const sameFile = (left: Stats, right: Stats) =>
	left.dev === right.dev &&
	left.ino === right.ino &&
	left.birthtimeMs === right.birthtimeMs;

function poll(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) return resolve();
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, milliseconds);
		signal.addEventListener("abort", done, { once: true });
	});
}

/** Find the last lines without retaining the complete file or a long line. */
async function tailStart(
	file: FileHandle,
	size: number,
	lines: number,
	buffer: Buffer,
	signal: AbortSignal,
): Promise<number> {
	if (!size || !lines) return size;
	const last = await file.read(buffer, 0, 1, size - 1);
	const needed = lines + (last.bytesRead && buffer[0] === 10 ? 1 : 0);
	let found = 0;
	let end = size;
	while (end > 0 && !signal.aborted) {
		const start = Math.max(0, end - buffer.length);
		const { bytesRead } = await file.read(buffer, 0, end - start, start);
		for (let index = bytesRead - 1; index >= 0; index--) {
			if (buffer[index] === 10 && ++found === needed) return start + index + 1;
		}
		end = start;
	}
	return 0;
}

/** Follow the file name. One descriptor, one read buffer, and UTF-8 carry are retained. */
export async function followLogFile(
	path: string,
	options: LogFileFollowOptions,
): Promise<void> {
	const chunkBytes = options.chunkBytes ?? 65_536;
	const initialLines = options.initialLines ?? 10;
	const pollMs = options.pollMs ?? 250;
	if (!Number.isInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 65_536)
		throw new Error("Log read size must be between 1 and 65536 bytes.");
	if (!Number.isSafeInteger(initialLines) || initialLines < 0)
		throw new Error("Initial log lines must be a non-negative integer.");
	if (!Number.isFinite(pollMs) || pollMs < 1)
		throw new Error("Log poll interval must be positive.");
	const buffer = Buffer.alloc(chunkBytes);
	let file: FileHandle | undefined;
	let identity: Stats | undefined;
	let decoder = new StringDecoder("utf8");
	let offset = 0;
	let anchor = Buffer.alloc(0);
	let first = true;
	const write = (text: string): Promise<void> => new Promise((resolve, reject) => {
		if (!text || options.signal.aborted) return resolve();
		const done = () => {
			options.signal.removeEventListener("abort", done);
			resolve();
		};
		options.signal.addEventListener("abort", done, { once: true });
		try {
			Promise.resolve(options.write(text)).then(done, error => {
				options.signal.removeEventListener("abort", done);
				if (options.signal.aborted) resolve();
				else reject(error);
			});
		} catch (error) {
			options.signal.removeEventListener("abort", done);
			reject(error);
		}
	});
	const reset = async () => {
		await write(decoder.end());
		decoder = new StringDecoder("utf8");
		offset = 0;
		anchor = Buffer.alloc(0);
	};
	try {
		while (!options.signal.aborted) {
			let named: Stats | undefined;
			try {
				named = await stat(path);
			} catch (error) {
				if (!missing(error)) throw error;
			}
			if (file && named && identity && !sameFile(named, identity)) {
				await reset();
				await file.close();
				file = undefined;
			}
			if (!file && named) {
				try {
					file = await open(path, "r");
				} catch (error) {
					if (!missing(error)) throw error;
				}
				if (file) {
					identity = await file.stat();
					if (!identity.isFile()) throw new Error("The log path must be a file.");
					offset = first
						? await tailStart(file, identity.size, initialLines, buffer, options.signal)
						: 0;
					first = false;
				}
			}
			if (file) {
				const current = await file.stat();
				if (current.size < offset) await reset();
				else if (anchor.length) {
					const { bytesRead } = await file.read(buffer, 0, anchor.length, offset - anchor.length);
					if (bytesRead !== anchor.length || !buffer.subarray(0, bytesRead).equals(anchor)) await reset();
				}
				while (offset < current.size && !options.signal.aborted) {
					const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, current.size - offset), offset);
					if (!bytesRead) break;
					offset += bytesRead;
					anchor = Buffer.from(buffer.subarray(Math.max(0, bytesRead - 64), bytesRead));
					await write(decoder.write(buffer.subarray(0, bytesRead)));
				}
			}
			if (!options.signal.aborted) await poll(pollMs, options.signal);
		}
	} catch (error) {
		if (!options.signal.aborted) throw error;
	} finally {
		await file?.close();
	}
}
