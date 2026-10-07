import { afterEach, expect, test } from "bun:test";
import { FileSystem, Path, Error as PlatformError } from "@effect/platform";
import { BunContext } from "@effect/platform-bun";
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute } from "node:path";
import { Cause, Deferred, Effect, Fiber } from "effect";
import {
	Contexts,
	makeContexts,
} from "../../../../../core/tools/context/context";
import { CONTEXT_LIMITS } from "../../../../../core/tools/context/contracts";
import {
	ContextImageExportError,
	exportContextImages,
} from "../../../../../core/tools/context/image-export";
import { createContextStore } from "../../../../../core/tools/context/store";
import { LogStore } from "../../../../../core/tools/logs/store";
import {
	contextImageEvidence,
	contextPng,
	contextJpeg,
} from "../../../../fixtures/context-image";

const directories = new Set<string>();
afterEach(async () => {
	for (const directory of directories)
		await rm(directory, { recursive: true, force: true });
	directories.clear();
});

async function fixture(options: Parameters<typeof createContextStore>[0] = {}) {
	const store = createContextStore(options);
	const contexts = makeContexts(store);
	const disk = await Effect.runPromise(
		FileSystem.FileSystem.pipe(Effect.provide(BunContext.layer)),
	);
	const fileSystem: FileSystem.FileSystem = {
		...disk,
		makeTempDirectory: (options) =>
			disk.makeTempDirectory(options).pipe(
				Effect.tap((directory) =>
					Effect.sync(() => {
						directories.add(directory);
					}),
				),
			),
	};
	const provide = <A, E>(
		operation: Effect.Effect<
			A,
			E,
			Contexts | FileSystem.FileSystem | Path.Path
		>,
		fs = fileSystem,
		service = contexts,
	) =>
		operation.pipe(
			Effect.provideService(Contexts, service),
			Effect.provideService(FileSystem.FileSystem, fs),
			Effect.provide(BunContext.layer),
		);
	const run = <A, E>(
		operation: Effect.Effect<
			A,
			E,
			Contexts | FileSystem.FileSystem | Path.Path
		>,
		fs = fileSystem,
		service = contexts,
	) => Effect.runPromise(provide(operation, fs, service));
	return { store, contexts, fileSystem, provide, run };
}

test("exports frozen iOS PNG and Android JPEG bytes in selection order without changing receipts", async () => {
	const { store, run } = await fixture();
	const original = contextImageEvidence();
	const ios = store.save("one", store.createDraft("one", original).id);
	const android = store.save(
		"one",
		store.createDraft(
			"one",
			contextImageEvidence("android:b", "android", "image/jpeg"),
		).id,
	);
	original.image.base64 = contextJpeg;
	original.target.rect.x = 999;
	const files = await run(
		exportContextImages("one", [android.id, ios.id, android.id]),
	);
	expect(files.map((file) => file.id)).toEqual([android.id, ios.id]);
	expect(files.map((file) => file.mimeType)).toEqual([
		"image/jpeg",
		"image/png",
	]);
	expect(files.map((file) => [file.width, file.height])).toEqual([
		[1, 1],
		[1, 1],
	]);
	expect(files.every((file) => isAbsolute(file.path))).toBe(true);
	expect((await readFile(files[0]!.path)).toString("base64")).toBe(contextJpeg);
	expect((await readFile(files[1]!.path)).toString("base64")).toBe(contextPng);
	expect(store.get("one", ios.id)).toBe(ios);
	expect(ios.kind === "annotation" && ios.target.rect.x).toBe(0);
	expect(Object.isFrozen(ios)).toBe(true);
});

test("concurrent retries reuse stable private paths and leave no partial files", async () => {
	const { store, run } = await fixture();
	const item = store.createDraft("one", contextImageEvidence());
	const results = await run(
		Effect.all(
			Array.from({ length: 8 }, () => exportContextImages("one", [item.id])),
			{ concurrency: "unbounded" },
		),
	);
	const destination = results[0]![0]!.path;
	expect(results.every((files) => files[0]!.path === destination)).toBe(true);
	expect(directories.size).toBe(1);
	expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
	expect((await readFile(destination)).toString("base64")).toBe(contextPng);
	if (process.platform !== "win32") {
		expect((await stat(dirname(destination))).mode & 0o777).toBe(0o700);
		expect((await stat(destination)).mode & 0o777).toBe(0o600);
	}
	store.updateNote("one", item.id, "Edited after export.");
	store.save("one", item.id);
	expect((await run(exportContextImages("one", [item.id])))[0]!.path).toBe(
		destination,
	);
});

test("paths stay readable after item removal, workspace clear, and context disposal", async () => {
	const { store, run } = await fixture();
	const first = store.createDraft("one", contextImageEvidence());
	const second = store.createDraft(
		"one",
		contextImageEvidence("android:b", "android"),
	);
	const files = await run(exportContextImages("one", [first.id, second.id]));
	store.remove("one", first.id);
	store.clearWorkspace("one");
	store.dispose();
	for (const file of files)
		expect((await readFile(file.path)).toString("base64")).toBe(contextPng);
});

test("workspace ownership is enforced and identifiers cannot choose a destination", async () => {
	const { store, run } = await fixture({ id: () => "../../same-id" });
	const first = store.createDraft("../../one", contextImageEvidence());
	const second = store.createDraft(
		"../../two",
		contextImageEvidence("android:b", "android", "image/jpeg"),
	);
	const one = (await run(exportContextImages("../../one", [first.id])))[0]!;
	const two = (await run(exportContextImages("../../two", [second.id])))[0]!;
	expect(one.path).not.toBe(two.path);
	expect(dirname(one.path)).toBe(dirname(two.path));
	expect(basename(one.path)).toMatch(/^screenshot-[a-f0-9]{64}\.png$/);
	expect(basename(two.path)).toMatch(/^screenshot-[a-f0-9]{64}\.jpg$/);
	const foreign = await run(
		Effect.either(exportContextImages("foreign", [first.id])),
	);
	expect(foreign._tag === "Left" && foreign.left.code).toBe("missing");
	expect(await readdir(dirname(one.path))).toHaveLength(2);
});

test("invalid selections, missing receipts, and log-only notes fail before any file is created", async () => {
	const { store, run } = await fixture();
	const image = store.createDraft("one", contextImageEvidence());
	const record = new LogStore().append({
		device: "ios-a",
		platform: "ios",
		source: "ios-native",
		level: "error",
		message: "Captured failure",
	});
	const logs = store.createDraft("one", {
		kind: "logs",
		device: "ios-a",
		platform: "ios",
		capturedAt: 0,
		note: "Inspect this",
		logs: [record],
	});
	const requests: Array<[unknown, unknown, string]> = [
		["", [image.id], "invalid"],
		["one", null, "invalid"],
		["one", [], "invalid"],
		["one", [""], "invalid"],
		["one", [42], "invalid"],
		["one", Array(33).fill(image.id), "invalid"],
		["one", [image.id, "missing"], "missing"],
		["one", [image.id, logs.id], "invalid"],
	];
	for (const [workspace, ids, code] of requests) {
		const result = await run(
			Effect.either(exportContextImages(workspace, ids)),
		);
		expect(result._tag === "Left" && result.left.code).toBe(code);
	}
	expect(directories.size).toBe(0);
	expect(store.list("one")).toHaveLength(2);
});

test("enforces both decoded image and aggregate export limits before allocating files", async () => {
	const { store, contexts, run } = await fixture();
	const item = store.createDraft("one", contextImageEvidence());
	if (item.kind !== "annotation") throw new Error("fixture");
	const tooLarge = Buffer.alloc(CONTEXT_LIMITS.imageBytes + 1).toString(
		"base64",
	);
	const perImage = await run(
		Effect.either(exportContextImages("one", [item.id])),
		undefined,
		{
			...contexts,
			get: () =>
				Effect.succeed({ ...item, image: { ...item.image, base64: tooLarge } }),
		},
	);
	expect(perImage._tag === "Left" && perImage.left.code).toBe("limit");
	const maximum = Buffer.alloc(CONTEXT_LIMITS.imageBytes).toString("base64");
	const aggregate = await run(
		Effect.either(
			exportContextImages(
				"one",
				Array.from({ length: 9 }, (_, i) => `receipt-${i}`),
			),
		),
		undefined,
		{
			...contexts,
			get: (_, id) =>
				Effect.succeed({
					...item,
					id,
					image: { ...item.image, base64: maximum },
				}),
		},
	);
	expect(aggregate._tag === "Left" && aggregate.left.code).toBe("limit");
	expect(directories.size).toBe(0);
});

test("a failed atomic write retains original files and receipts and permits a clean retry", async () => {
	const { store, fileSystem, run } = await fixture();
	const item = store.createDraft("one", contextImageEvidence());
	const destination = (await run(exportContextImages("one", [item.id])))[0]!
		.path;
	const error = new PlatformError.SystemError({
		module: "FileSystem",
		method: "rename",
		reason: "PermissionDenied",
		pathOrDescriptor: "private test path",
	});
	const failed = await run(
		Effect.either(exportContextImages("one", [item.id])),
		{
			...fileSystem,
			rename: () => Effect.fail(error),
		},
	);
	expect(failed._tag === "Left" && failed.left).toBeInstanceOf(
		ContextImageExportError,
	);
	if (failed._tag === "Left")
		expect(failed.left.message).not.toContain("private test path");
	expect((await readFile(destination)).toString("base64")).toBe(contextPng);
	expect(await readdir(dirname(destination))).toEqual([basename(destination)]);
	expect(store.get("one", item.id)).toBe(item);
	expect((await run(exportContextImages("one", [item.id])))[0]!.path).toBe(
		destination,
	);
});

test("directory setup failure cleans the unused directory and does not poison retry", async () => {
	const { store, fileSystem, run } = await fixture();
	const item = store.createDraft("one", contextImageEvidence());
	const error = new PlatformError.SystemError({
		module: "FileSystem",
		method: "chmod",
		reason: "PermissionDenied",
		pathOrDescriptor: "private test path",
	});
	const failed = await run(
		Effect.either(exportContextImages("one", [item.id])),
		{
			...fileSystem,
			chmod: () => Effect.fail(error),
		},
	);
	expect(failed._tag === "Left" && failed.left).toBeInstanceOf(
		ContextImageExportError,
	);
	const abandoned = [...directories][0]!;
	expect(
		await stat(abandoned).then(
			() => true,
			() => false,
		),
	).toBe(false);
	expect(store.get("one", item.id)).toBe(item);
	const files = await run(exportContextImages("one", [item.id]));
	expect(dirname(files[0]!.path)).not.toBe(abandoned);
	expect((await readFile(files[0]!.path)).toString("base64")).toBe(contextPng);
});

test("request interruption finishes its atomic write and releases the lock for later exports", async () => {
	const { store, fileSystem, provide, run } = await fixture();
	const item = store.createDraft("one", contextImageEvidence());
	const started = await Effect.runPromise(Deferred.make<void>());
	const release = await Effect.runPromise(Deferred.make<void>());
	const interrupted = await Effect.runPromise(
		Effect.gen(function* () {
			const fiber = yield* Effect.fork(
				provide(exportContextImages("one", [item.id]), {
					...fileSystem,
					writeFile: (path, bytes, options) =>
						fileSystem
							.writeFile(path, bytes, options)
							.pipe(
								Effect.zipRight(Deferred.succeed(started, undefined)),
								Effect.zipRight(Deferred.await(release)),
							),
				}),
			);
			yield* Deferred.await(started);
			const cancellation = yield* Effect.fork(Fiber.interrupt(fiber));
			yield* Deferred.succeed(release, undefined);
			return yield* Fiber.join(cancellation);
		}),
	);
	expect(
		interrupted._tag === "Failure" && Cause.isInterrupted(interrupted.cause),
	).toBe(true);
	const directory = [...directories][0]!;
	expect(await readdir(directory)).toHaveLength(1);
	const files = await run(exportContextImages("one", [item.id]));
	expect((await readFile(files[0]!.path)).toString("base64")).toBe(contextPng);
	expect(await readdir(directory)).toEqual([basename(files[0]!.path)]);
});
