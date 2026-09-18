import { screenshotsDirectory } from "../core/home";
import {
	mkdirSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";

export type ScreenshotKind = "observe" | "screenshot" | "action";

export interface StoredScreenshot {
	name: string;
	modifiedMs: number;
}

export interface WriteScreenshotOptions {
	kind: ScreenshotKind;
	device: string;
	content: Uint8Array;
	mimeType?: string;
	outputPath?: string;
	now?: Date;
	environment?: { AGENTSIMS_SCREENSHOT_DIR?: string };
	homeDirectory?: string;
}

export const SCREENSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const SCREENSHOT_MAX_COUNT = 40;
/** Files younger than this are never pruned for overflow, so one command that writes many sheets and frames cannot evict its own output. */
export const SCREENSHOT_MIN_KEEP_MS = 10 * 60 * 1000;

const MANAGED_SCREENSHOT_NAME =
	/^(?:observe|screenshot|action)-[0-9A-Za-z._-]+-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(?:-\d+)?\.(?:jpg|png|webp)$/;

export function screenshotExtension(mimeType: string | undefined): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	return "png";
}

export function screenshotFileName(
	kind: ScreenshotKind,
	device: string,
	mimeType: string | undefined,
	now: Date,
): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	const safeDevice = device.replace(/[^0-9A-Za-z._-]/g, "_") || "device";
	return `${kind}-${safeDevice}-${stamp}.${screenshotExtension(mimeType)}`;
}

export function screenshotsToPrune(
	shots: readonly StoredScreenshot[],
	nowMs: number,
	maxAgeMs = SCREENSHOT_MAX_AGE_MS,
	maxCount = SCREENSHOT_MAX_COUNT,
): string[] {
	const newestFirst = [...shots].sort((a, b) => b.modifiedMs - a.modifiedMs);
	return newestFirst
		.filter(
			(shot, index) =>
				(index >= maxCount && nowMs - shot.modifiedMs > SCREENSHOT_MIN_KEEP_MS) ||
				nowMs - shot.modifiedMs > maxAgeMs,
		)
		.map((shot) => shot.name);
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function writeError(path: string, error: unknown): Error {
	return new Error(`Screenshot write failed for ${path}: ${errorText(error)}`);
}

function writeExclusive(path: string, content: Uint8Array): boolean {
	try {
		writeFileSync(path, content, { flag: "wx" });
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
		throw writeError(path, error);
	}
}

function pruneManagedScreenshots(
	directory: string,
	nowMs: number,
	newScreenshot: string,
): void {
	try {
		const shots = readdirSync(directory, { withFileTypes: true })
			.filter(
				(entry) => entry.isFile() && MANAGED_SCREENSHOT_NAME.test(entry.name),
			)
			.map((entry) => ({
				name: entry.name,
				modifiedMs:
					entry.name === newScreenshot
						? nowMs
						: statSync(join(directory, entry.name)).mtimeMs,
			}));
		for (const name of screenshotsToPrune(shots, nowMs))
			unlinkSync(join(directory, name));
	} catch {
		// Retention is best effort. A cleanup error must not hide a saved image.
	}
}

function collisionPath(path: string, collision: number): string {
	const extension = extname(path);
	return `${path.slice(0, -extension.length)}-${collision}${extension}`;
}

export function writeScreenshotFile(options: WriteScreenshotOptions): string {
	const now = options.now ?? new Date();
	const outputPath = options.outputPath || undefined;
	const environment = options.environment ?? process.env;
	const environmentDirectory =
		environment.AGENTSIMS_SCREENSHOT_DIR || undefined;
	const managed = !outputPath && !environmentDirectory;
	const directory = outputPath
		? dirname(resolve(outputPath))
		: resolve(
				environmentDirectory ??
					(options.homeDirectory
						? join(options.homeDirectory, "screenshots")
						: screenshotsDirectory()),
			);
	const target = outputPath
		? resolve(outputPath)
		: join(
				directory,
				screenshotFileName(
					options.kind,
					options.device,
					options.mimeType,
					now,
				),
			);

	try {
		mkdirSync(directory, { recursive: true });
	} catch (error) {
		throw writeError(target, error);
	}

	if (outputPath) {
		try {
			writeFileSync(target, options.content);
		} catch (error) {
			throw writeError(target, error);
		}
		return target;
	}

	let candidate = target;
	let collision = 2;
	while (!writeExclusive(candidate, options.content)) {
		candidate = collisionPath(target, collision);
		collision += 1;
	}
	if (managed)
		pruneManagedScreenshots(directory, now.getTime(), basename(candidate));
	return candidate;
}
