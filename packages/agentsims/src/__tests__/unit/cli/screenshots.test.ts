import { afterEach, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
	SCREENSHOT_MAX_AGE_MS,
	SCREENSHOT_MAX_COUNT,
	SCREENSHOT_MIN_KEEP_MS,
	screenshotExtension,
	screenshotFileName,
	screenshotsToPrune,
	writeScreenshotFile,
} from "../../../cli/screenshots";

const roots: string[] = [];

function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "agentsims-screenshot-test-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

test("explicit path takes precedence and all returned paths are absolute", () => {
	const root = temporaryRoot();
	const explicit = join(root, "explicit", "chosen.png");
	const environmentDirectory = join(root, "environment");
	const homeDirectory = join(root, "temporary");

	const path = writeScreenshotFile({
		kind: "observe",
		device: "ios-device",
		content: Buffer.from("explicit"),
		outputPath: explicit,
		environment: { AGENTSIMS_SCREENSHOT_DIR: environmentDirectory },
		homeDirectory,
	});

	expect(path).toBe(resolve(explicit));
	expect(readFileSync(path, "utf8")).toBe("explicit");
	expect(existsSync(environmentDirectory)).toBe(false);
	expect(existsSync(homeDirectory)).toBe(false);
});

test("environment directory takes precedence over the default temp directory", () => {
	const root = temporaryRoot();
	const environmentDirectory = join(root, "environment");
	const homeDirectory = join(root, "temporary");
	const path = writeScreenshotFile({
		kind: "action",
		device: "android:emulator-5554",
		content: Buffer.from("environment"),
		environment: { AGENTSIMS_SCREENSHOT_DIR: environmentDirectory },
		homeDirectory,
		now: new Date("2026-09-17T01:02:03.004Z"),
	});

	expect(dirname(path)).toBe(resolve(environmentDirectory));
	expect(path).toBe(
		join(
			resolve(environmentDirectory),
			"action-android_emulator-5554-2026-09-17T01-02-03-004Z.png",
		),
	);
	expect(existsSync(homeDirectory)).toBe(false);
});

test("default writes use the home screenshots directory", () => {
	const root = temporaryRoot();
	const path = writeScreenshotFile({
		kind: "screenshot",
		device: "ios-device",
		content: Buffer.from("default"),
		environment: {},
		homeDirectory: root,
		now: new Date("2026-09-17T01:02:03.004Z"),
	});

	expect(path).toBe(
		join(
			resolve(root),
			"screenshots",
			"screenshot-ios-device-2026-09-17T01-02-03-004Z.png",
		),
	);
	expect(isAbsolute(path)).toBe(true);
});

test("generated names use MIME extensions and do not overwrite collisions", () => {
	const root = temporaryRoot();
	const now = new Date("2026-09-17T01:02:03.004Z");
	const options = {
		kind: "observe" as const,
		device: "android:emulator-5554",
		mimeType: "image/jpeg",
		environment: { AGENTSIMS_SCREENSHOT_DIR: root },
		now,
	};
	const first = writeScreenshotFile({
		...options,
		content: Buffer.from("first"),
	});
	const second = writeScreenshotFile({
		...options,
		content: Buffer.from("second"),
	});

	expect(first).toEndWith(
		"observe-android_emulator-5554-2026-09-17T01-02-03-004Z.jpg",
	);
	expect(second).toEndWith(
		"observe-android_emulator-5554-2026-09-17T01-02-03-004Z-2.jpg",
	);
	expect(readFileSync(first, "utf8")).toBe("first");
	expect(readFileSync(second, "utf8")).toBe("second");
	expect(screenshotExtension("image/webp")).toBe("webp");
	expect(screenshotExtension("image/png")).toBe("png");
	expect(screenshotExtension(undefined)).toBe("png");
	expect(
		screenshotFileName("observe", "ios:device", "image/webp", now),
	).toBe("observe-ios_device-2026-09-17T01-02-03-004Z.webp");
});

test("default retention keeps the age boundary and preserves unrelated files", () => {
	const root = temporaryRoot();
	const directory = join(root, "screenshots");
	mkdirSync(directory, { recursive: true });
	const now = new Date("2026-09-17T12:00:00.000Z");
	const boundary = screenshotFileName(
		"observe",
		"boundary",
		"image/png",
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS),
	);
	const stale = screenshotFileName(
		"action",
		"stale",
		"image/png",
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS - 1),
	);
	const unrelated = "observe-user-file.png";
	for (const name of [boundary, stale, unrelated]) {
		const path = join(directory, name);
		writeFileSync(path, name);
	}
	utimesSync(
		join(directory, boundary),
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS),
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS),
	);
	utimesSync(
		join(directory, stale),
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS - 1),
		new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS - 1),
	);

	writeScreenshotFile({
		kind: "screenshot",
		device: "current",
		content: Buffer.from("current"),
		environment: {},
		homeDirectory: root,
		now,
	});

	expect(existsSync(join(directory, boundary))).toBe(true);
	expect(existsSync(join(directory, stale))).toBe(false);
	expect(existsSync(join(directory, unrelated))).toBe(true);
});

test("default retention removes only overflow from managed files", () => {
	const root = temporaryRoot();
	const directory = join(root, "screenshots");
	mkdirSync(directory, { recursive: true });
	const now = new Date("2026-09-17T12:00:00.000Z");
	let oldest = "";
	for (let index = 0; index < SCREENSHOT_MAX_COUNT; index += 1) {
		// Old enough to be overflow candidates; fresh files are never pruned.
		const at = new Date(
			now.getTime() - SCREENSHOT_MIN_KEEP_MS - (index + 1) * 1_000,
		);
		const name = screenshotFileName("observe", `device-${index}`, "image/png", at);
		if (index === SCREENSHOT_MAX_COUNT - 1) oldest = name;
		const path = join(directory, name);
		writeFileSync(path, name);
		utimesSync(path, at, at);
	}
	const unrelated = join(directory, "notes.png");
	writeFileSync(unrelated, "notes");

	writeScreenshotFile({
		kind: "observe",
		device: "current",
		content: Buffer.from("current"),
		environment: {},
		homeDirectory: root,
		now,
	});

	const managed = readdirSync(directory).filter((name) => name !== "notes.png");
	expect(managed).toHaveLength(SCREENSHOT_MAX_COUNT);
	expect(existsSync(join(directory, oldest))).toBe(false);
	expect(readFileSync(unrelated, "utf8")).toBe("notes");
});

test("user-managed directories are not pruned", () => {
	const root = temporaryRoot();
	const directory = join(root, "user-managed");
	mkdirSync(directory, { recursive: true });
	const now = new Date("2026-09-17T12:00:00.000Z");
	for (let index = 0; index < SCREENSHOT_MAX_COUNT + 2; index += 1) {
		const name = screenshotFileName(
			"observe",
			`device-${index}`,
			"image/png",
			new Date(now.getTime() - SCREENSHOT_MAX_AGE_MS - index - 1),
		);
		writeFileSync(join(directory, name), name);
	}

	writeScreenshotFile({
		kind: "observe",
		device: "current",
		content: Buffer.from("current"),
		environment: { AGENTSIMS_SCREENSHOT_DIR: directory },
		now,
	});

	expect(readdirSync(directory)).toHaveLength(SCREENSHOT_MAX_COUNT + 3);
});

test("an explicit path overwrites an existing file and keeps its path", () => {
	const root = temporaryRoot();
	const path = join(root, "selected.png");
	writeFileSync(path, "keep");

	const written = writeScreenshotFile({
		kind: "observe",
		device: "ios-device",
		content: Buffer.from("replace"),
		outputPath: path,
	});

	expect(written).toBe(resolve(path));
	expect(readFileSync(written, "utf8")).toBe("replace");
	expect(readdirSync(root)).toEqual(["selected.png"]);
});

test("filesystem errors name the target path", () => {
	const root = temporaryRoot();
	const blocker = join(root, "not-a-directory");
	writeFileSync(blocker, "file");
	const path = join(blocker, "shot.png");

	expect(() =>
		writeScreenshotFile({
			kind: "observe",
			device: "ios-device",
			content: Buffer.from("image"),
			outputPath: path,
		}),
	).toThrow(`Screenshot write failed for ${resolve(path)}:`);
	expect(statSync(blocker).isFile()).toBe(true);
});

test("retention uses strict age and count boundaries", () => {
	const now = Date.UTC(2026, 8, 17, 12, 0, 0);
	// All old enough to count as overflow; fresh files are exempt.
	const shots = Array.from({ length: SCREENSHOT_MAX_COUNT + 1 }, (_, index) => ({
		name: `${index}`,
		modifiedMs: now - SCREENSHOT_MIN_KEEP_MS - 1 - index,
	}));
	expect(screenshotsToPrune(shots, now, SCREENSHOT_MAX_AGE_MS)).toEqual([
		`${SCREENSHOT_MAX_COUNT}`,
	]);
	expect(
		screenshotsToPrune(
			[
				{ name: "boundary", modifiedMs: now - SCREENSHOT_MAX_AGE_MS },
				{ name: "stale", modifiedMs: now - SCREENSHOT_MAX_AGE_MS - 1 },
			],
			now,
		),
	).toEqual(["stale"]);
});

test("one command that writes many files never prunes its own output", () => {
	const root = temporaryRoot();
	const directory = join(root, "screenshots");
	mkdirSync(directory, { recursive: true });
	const now = new Date("2026-09-17T12:00:00.000Z");
	for (let index = 0; index < SCREENSHOT_MAX_COUNT + 20; index += 1) {
		const at = new Date(now.getTime() - (index + 1) * 100);
		const name = screenshotFileName("observe", `frame-${index}`, "image/png", at);
		const path = join(directory, name);
		writeFileSync(path, name);
		utimesSync(path, at, at);
	}

	writeScreenshotFile({
		kind: "observe",
		device: "sheet",
		content: Buffer.from("sheet"),
		environment: {},
		homeDirectory: root,
		now,
	});

	expect(readdirSync(directory)).toHaveLength(SCREENSHOT_MAX_COUNT + 21);
});
