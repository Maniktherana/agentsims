import { FileSystem, Path } from "@effect/platform";
import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { Contexts } from "./context";
import { ContextError, CONTEXT_LIMITS } from "./contracts";
import type { ContextItem } from "./contracts";
import { contextWorkspace } from "./input";

export type ContextImageFile = {
	readonly id: string;
	readonly path: string;
	readonly mimeType: "image/png" | "image/jpeg";
	readonly width: number;
	readonly height: number;
};

export class ContextImageExportError extends Error {
	readonly code = "export";
	constructor() {
		super(
			"Could not save screenshots. Try Copy prompt again. Your notes are retained.",
		);
		this.name = "ContextImageExportError";
	}
}

type ImageItem = Extract<ContextItem, { kind: "annotation" }>;
type Output = { lock: Effect.Semaphore; directory?: string };
const outputs = new WeakMap<typeof Contexts.Service, Output>();
const invalidRequest = (error: unknown) =>
	error instanceof ContextError
		? error
		: new ContextError("invalid", "Invalid context request.");

function selection(workspace: unknown, ids: unknown) {
	const selectedWorkspace = contextWorkspace(workspace);
	if (
		!Array.isArray(ids) ||
		!ids.length ||
		ids.length > CONTEXT_LIMITS.itemsPerWorkspace ||
		ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 256)
	)
		throw new ContextError("invalid", "Select between 1 and 32 context items.");
	return { workspace: selectedWorkspace, ids: [...new Set(ids as string[])] };
}

function images(items: readonly ContextItem[]): readonly ImageItem[] {
	let bytes = 0;
	for (const item of items) {
		if (item.kind !== "annotation")
			throw new ContextError(
				"invalid",
				"Select context items with screenshots.",
			);
		const image = item.image;
		const size = Buffer.byteLength(image.base64, "base64");
		if (
			image.base64.length > Math.ceil(CONTEXT_LIMITS.imageBytes / 3) * 4 ||
			size > CONTEXT_LIMITS.imageBytes
		)
			throw new ContextError("limit", "A screenshot exceeds 8 MiB.");
		bytes += size;
		if (bytes > CONTEXT_LIMITS.bytesTotal)
			throw new ContextError("limit", "Screenshot export exceeds 64 MiB.");
	}
	return items as readonly ImageItem[];
}

/** Export captured evidence only. These files outlive notes and runtime shutdown. */
export function exportContextImages(workspace: unknown, ids: unknown) {
	return Effect.gen(function* () {
		const selected = yield* Effect.try({
			try: () => selection(workspace, ids),
			catch: invalidRequest,
		});
		const contexts = yield* Contexts;
		const items = yield* Effect.all(
			selected.ids.map((id) => contexts.get(selected.workspace, id)),
		);
		const captured = yield* Effect.try({
			try: () => images(items),
			catch: invalidRequest,
		});
		const fileSystem = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		let output = outputs.get(contexts);
		if (!output) {
			output = { lock: Effect.unsafeMakeSemaphore(1) };
			outputs.set(contexts, output);
		}
		const owned = output;
		return yield* owned.lock.withPermits(1)(
			Effect.gen(function* () {
				if (!owned.directory) {
					yield* Effect.gen(function* () {
						const directory = yield* fileSystem.makeTempDirectory({
							prefix: "agentsims-context-",
						});
						yield* fileSystem
							.chmod(directory, 0o700)
							.pipe(
								Effect.onError(() =>
									fileSystem
										.remove(directory, { recursive: true })
										.pipe(Effect.ignore),
								),
							);
						owned.directory = directory;
					}).pipe(Effect.uninterruptible);
				}
				const directory = owned.directory!;
				return yield* Effect.forEach(captured, (item) => {
					const extension = item.image.mimeType === "image/png" ? "png" : "jpg";
					const hash = createHash("sha256")
						.update(JSON.stringify([selected.workspace, item.id]))
						.digest("hex");
					const name = `screenshot-${hash}.${extension}`;
					const destination = path.join(directory, name);
					const temporary = path.join(
						directory,
						`.${name}-${randomUUID()}.tmp`,
					);
					return Effect.gen(function* () {
						yield* fileSystem.writeFile(
							temporary,
							Buffer.from(item.image.base64, "base64"),
							{ flag: "wx", mode: 0o600 },
						);
						yield* fileSystem.rename(temporary, destination);
						return {
							id: item.id,
							path: destination,
							mimeType: item.image.mimeType,
							width: item.image.width,
							height: item.image.height,
						} satisfies ContextImageFile;
					}).pipe(
						Effect.ensuring(fileSystem.remove(temporary).pipe(Effect.ignore)),
						// Finish each atomic write before releasing the export lock.
						Effect.uninterruptible,
					);
				});
			}).pipe(Effect.mapError(() => new ContextImageExportError())),
		);
	});
}
