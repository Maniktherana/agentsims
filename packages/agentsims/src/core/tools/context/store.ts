import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { CONTEXT_LIMITS, ContextError } from "./contracts";
import type {
	ContextImage,
	ContextInput,
	ContextItem,
	ContextTarget,
} from "./contracts";

function freeze<T>(value: T): T {
	if (value && typeof value === "object" && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}

function bytes(value: unknown): number {
	return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function invalid(message: string): never {
	throw new ContextError("invalid", message);
}

function limit(message: string): never {
	throw new ContextError("limit", message);
}

function identifier(value: string, name: string): void {
	if (typeof value !== "string" || !value.trim() || value.length > 256)
		invalid(`Invalid ${name}.`);
}

function note(value: string): void {
	if (typeof value !== "string") invalid("Invalid note.");
	if (value.length > CONTEXT_LIMITS.noteCharacters)
		limit("The note exceeds 4,096 characters.");
}

/** Read dimensions before any image decoder can allocate a pixel buffer. */
function imageDimensions(
	data: Buffer,
	mime: ContextImage["mimeType"],
): [number, number] {
	if (mime === "image/png") {
		if (
			data.length < 45 ||
			data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
			data.readUInt32BE(8) !== 13 ||
			data.toString("ascii", 12, 16) !== "IHDR" ||
			data.toString("ascii", data.length - 8, data.length - 4) !== "IEND"
		)
			invalid("Invalid PNG image.");
		return [data.readUInt32BE(16), data.readUInt32BE(20)];
	}
	if (
		mime !== "image/jpeg" ||
		data.length < 4 ||
		data.readUInt16BE(0) !== 0xffd8 ||
		data.readUInt16BE(data.length - 2) !== 0xffd9
	)
		invalid("Invalid JPEG image.");
	let offset = 2;
	while (offset + 4 <= data.length) {
		if (data[offset++] !== 0xff) invalid("Invalid JPEG image.");
		while (data[offset] === 0xff) offset++;
		const marker = data[offset++]!;
		if (marker === 0xda || marker === 0xd9) break;
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
		if (offset + 2 > data.length) break;
		const length = data.readUInt16BE(offset);
		if (length < 2 || offset + length > data.length) break;
		if (
			[
				0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
				0xcf,
			].includes(marker)
		) {
			if (length < 8) break;
			return [data.readUInt16BE(offset + 5), data.readUInt16BE(offset + 3)];
		}
		offset += length;
	}
	return invalid("The JPEG image has no dimensions.");
}

function validateImage(image: ContextImage): number {
	if (!image || typeof image.base64 !== "string")
		invalid("Missing image evidence.");
	if (image.base64.length > Math.ceil(CONTEXT_LIMITS.imageBytes / 3) * 4)
		limit("The image exceeds 8 MiB.");
	if (
		!image.base64.length ||
		image.base64.length % 4 !== 0 ||
		!/^[A-Za-z0-9+/]*={0,2}$/.test(image.base64)
	)
		invalid("Invalid image encoding.");
	const data = Buffer.from(image.base64, "base64");
	if (data.length > CONTEXT_LIMITS.imageBytes)
		limit("The image exceeds 8 MiB.");
	if (data.toString("base64") !== image.base64)
		invalid("Invalid image encoding.");
	const [width, height] = imageDimensions(data, image.mimeType);
	if (
		width !== image.width ||
		height !== image.height ||
		!width ||
		!height ||
		width > 16384 ||
		height > 16384 ||
		width * height > 32_000_000
	)
		invalid("Invalid image dimensions.");
	return data.length;
}

function validateTarget(target: ContextTarget, image: ContextImage): void {
	if (!target || (target.kind !== "element" && target.kind !== "region"))
		invalid("Invalid annotation target.");
	if (bytes(target) > CONTEXT_LIMITS.targetBytes)
		limit("The target exceeds 32 KiB.");
	const rect = target.rect;
	if (
		!rect ||
		![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ||
		rect.x < 0 ||
		rect.y < 0 ||
		rect.width <= 0 ||
		rect.height <= 0 ||
		rect.x + rect.width > image.width ||
		rect.y + rect.height > image.height
	)
		invalid("The target is outside the captured image.");
	if (target.kind === "region") {
		identifier(target.reason, "region reason");
		return;
	}
	identifier(target.app, "target app");
	identifier(target.orientation, "target orientation");
	if (
		!Number.isSafeInteger(target.revision) ||
		target.revision < 0 ||
		!Number.isFinite(target.collectedAt) ||
		target.collectedAt < 0 ||
		!target.element
	)
		invalid("Invalid target revision.");
	identifier(target.element.id, "target ID");
}

function validate(input: ContextInput): number {
	identifier(input.device, "device");
	if (input.platform !== "ios" && input.platform !== "android")
		invalid("Invalid platform.");
	if (!Number.isFinite(input.capturedAt) || input.capturedAt < 0)
		invalid("Invalid capture time.");
	note(input.note);
	if (!Array.isArray(input.logs)) invalid("Invalid log evidence.");
	if (
		input.logs.length > CONTEXT_LIMITS.logs ||
		bytes(input.logs) > CONTEXT_LIMITS.logBytes
	)
		limit("Log evidence exceeds 200 records or 64 KiB.");
	for (const record of input.logs) {
		if (record.device !== input.device || record.platform !== input.platform)
			invalid("Log evidence belongs to another device.");
		if (typeof record.id !== "string" || !record.id || record.id.length > 4120)
			invalid("Invalid log ID.");
	}
	if (input.kind === "logs") {
		if (!input.logs.length) invalid("Select at least one log record.");
		return 0;
	}
	if (input.kind !== "annotation") invalid("Invalid context kind.");
	identifier(input.sessionId, "session ID");
	const imageBytes = validateImage(input.image);
	validateTarget(input.target, input.image);
	const source = input.source;
	if (source) {
		identifier(source.projectKey, "source project");
		identifier(source.testID, "source ID");
		if (
			typeof source.file !== "string" ||
			!source.file ||
			source.file.length > 4096 ||
			!Array.isArray(source.lines) ||
			source.lines.some((line) => typeof line !== "string")
		)
			invalid("Invalid source evidence.");
		if (
			!Number.isSafeInteger(source.line) ||
			!Number.isSafeInteger(source.startLine) ||
			source.startLine < 1 ||
			source.line < source.startLine ||
			source.line >= source.startLine + source.lines.length
		)
			invalid("Invalid source lines.");
		if (
			source.lines.length > CONTEXT_LIMITS.sourceLines ||
			bytes(source) > CONTEXT_LIMITS.sourceBytes
		)
			limit("Source evidence exceeds 41 lines or 32 KiB.");
	}
	return imageBytes;
}

export function createContextStore(
	options: { now?: () => number; id?: () => string } = {},
) {
	const now = options.now ?? Date.now;
	const id = options.id ?? randomUUID;
	const workspaces = new Map<
		string,
		Map<
			string,
			{ item: ContextItem; bytes: number; requestId?: string; digest?: string }
		>
	>();
	let retainedBytes = 0;
	let closed = false;
	const open = () => {
		if (closed)
			throw new ContextError("closed", "The context store is closed.");
	};
	const entry = (workspace: string, itemId: string) => {
		open();
		const found = workspaces.get(workspace)?.get(itemId);
		if (!found) throw new ContextError("missing", "Context is unavailable.");
		return found;
	};
	const size = (item: ContextItem, imageBytes: number) => {
		const metadata =
			item.kind === "annotation"
				? { ...item, image: { ...item.image, base64: undefined } }
				: item;
		return bytes(metadata) + imageBytes;
	};
	const replace = (
		workspace: string,
		previous: ReturnType<typeof entry>,
		item: ContextItem,
	) => {
		const encoded = item.kind === "annotation" ? item.image.base64 : "";
		const imageBytes =
			(encoded.length / 4) * 3 -
			(encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
		const nextBytes = size(item, imageBytes);
		if (retainedBytes - previous.bytes + nextBytes > CONTEXT_LIMITS.bytesTotal)
			limit("Context storage is full. Remove an item to continue.");
		retainedBytes += nextBytes - previous.bytes;
		const detached = freeze(item);
		workspaces
			.get(workspace)!
			.set(item.id, { ...previous, item: detached, bytes: nextBytes });
		return detached;
	};
	return {
		createDraft(
			workspace: string,
			input: ContextInput,
			requestId?: string,
		): ContextItem {
			open();
			identifier(workspace, "workspace");
			const imageBytes = validate(input);
			const items = workspaces.get(workspace) ?? new Map();
			let digest: string | undefined;
			if (requestId !== undefined) {
				identifier(requestId, "request ID");
				digest = createHash("sha256")
					.update(JSON.stringify(input))
					.digest("hex");
				const prior = Array.from(items.values()).find(
					(value) => value.requestId === requestId,
				);
				if (prior) {
					if (prior.digest !== digest)
						invalid("The request ID belongs to different evidence.");
					return prior.item;
				}
			}
			if (items.size >= CONTEXT_LIMITS.itemsPerWorkspace)
				limit(
					"The workspace has 32 context items. Remove an item to continue.",
				);
			const timestamp = now();
			const item: ContextItem = freeze({
				...structuredClone(input),
				id: id(),
				workspace,
				state: "draft",
				createdAt: timestamp,
				updatedAt: timestamp,
			});
			if (items.has(item.id)) invalid("Duplicate context ID.");
			const itemBytes = size(item, imageBytes);
			if (retainedBytes + itemBytes > CONTEXT_LIMITS.bytesTotal)
				limit("Context storage is full. Remove an item to continue.");
			items.set(item.id, { item, bytes: itemBytes, requestId, digest });
			workspaces.set(workspace, items);
			retainedBytes += itemBytes;
			return item;
		},
		updateNote(workspace: string, itemId: string, text: string): ContextItem {
			const previous = entry(workspace, itemId);
			note(text);
			return replace(workspace, previous, {
				...previous.item,
				note: text,
				updatedAt: now(),
			});
		},
		save(workspace: string, itemId: string): ContextItem {
			const previous = entry(workspace, itemId);
			return previous.item.state === "saved"
				? previous.item
				: replace(workspace, previous, {
						...previous.item,
						state: "saved",
						updatedAt: now(),
					});
		},
		get(workspace: string, itemId: string): ContextItem {
			return entry(workspace, itemId).item;
		},
		list(workspace: string, device?: string): readonly ContextItem[] {
			open();
			return Object.freeze(
				Array.from(
					workspaces.get(workspace)?.values() ?? [],
					(value) => value.item,
				).filter((item) => !device || item.device === device),
			);
		},
		remove(workspace: string, itemId: string): boolean {
			open();
			const items = workspaces.get(workspace);
			const found = items?.get(itemId);
			if (!found) return false;
			retainedBytes -= found.bytes;
			items!.delete(itemId);
			if (!items!.size) workspaces.delete(workspace);
			return true;
		},
		clearWorkspace(workspace: string): void {
			open();
			for (const value of workspaces.get(workspace)?.values() ?? [])
				retainedBytes -= value.bytes;
			workspaces.delete(workspace);
		},
		usage() {
			return {
				bytes: retainedBytes,
				workspaces: workspaces.size,
				items: [...workspaces.values()].reduce(
					(total, items) => total + items.size,
					0,
				),
			};
		},
		dispose(): void {
			closed = true;
			workspaces.clear();
			retainedBytes = 0;
		},
	};
}
