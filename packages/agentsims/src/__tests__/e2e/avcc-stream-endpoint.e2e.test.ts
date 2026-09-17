import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	acquireIosSimulatorTestLock,
	IOS_E2E_HOOK_TIMEOUT_MS,
} from "../helpers/ios-e2e-lock";
import {
	explicitIosDevice,
	startOwnedE2EServer,
	type OwnedE2EServer,
} from "../helpers/native-e2e";

const TAG_DESCRIPTION = 0x01;
const TAG_KEYFRAME = 0x02;
const STREAM_DEADLINE_MS = 30_000;
const describeConfigured = explicitIosDevice ? describe : describe.skip;

function append(first: Uint8Array, second: Uint8Array): Uint8Array {
	const value = new Uint8Array(first.length + second.length);
	value.set(first);
	value.set(second, first.length);
	return value;
}

function avccTags(buffer: Uint8Array): { tags: number[]; rest: Uint8Array } {
	const tags: number[] = [];
	let offset = 0;
	while (buffer.length - offset >= 4) {
		const length = new DataView(
			buffer.buffer,
			buffer.byteOffset + offset,
			4,
		).getUint32(0, false);
		if (length < 1 || buffer.length - offset - 4 < length) break;
		tags.push(buffer[offset + 4]!);
		offset += 4 + length;
	}
	return { tags, rest: buffer.subarray(offset) };
}

async function firstMjpeg(url: string): Promise<Buffer> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), STREAM_DEADLINE_MS);
	try {
		const response = await fetch(url, { signal: controller.signal });
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain(
			"multipart/x-mixed-replace",
		);
		const reader = response.body!.getReader();
		let buffer = Buffer.alloc(0);
		while (true) {
			const next = await reader.read();
			if (next.done) throw new Error("MJPEG stream ended before a frame.");
			buffer = Buffer.concat([buffer, Buffer.from(next.value)]);
			const headerEnd = buffer.indexOf("\r\n\r\n");
			if (headerEnd < 0) continue;
			const header = buffer.toString("utf8", 0, headerEnd);
			const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1]);
			if (!Number.isSafeInteger(length) || length < 1)
				throw new Error("MJPEG frame has no valid Content-Length.");
			const start = headerEnd + 4;
			if (buffer.length < start + length) continue;
			await reader.cancel();
			return buffer.subarray(start, start + length);
		}
	} finally {
		clearTimeout(timeout);
	}
}

async function requiredAvccTags(url: string): Promise<Set<number>> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), STREAM_DEADLINE_MS);
	const tags = new Set<number>();
	try {
		const response = await fetch(url, { signal: controller.signal });
		expect(response.status).toBe(200);
		const reader = response.body!.getReader();
		let buffer = new Uint8Array(0);
		while (!tags.has(TAG_DESCRIPTION) || !tags.has(TAG_KEYFRAME)) {
			const next = await reader.read();
			if (next.done) throw new Error("AVCC stream ended before a keyframe.");
			buffer = append(buffer, next.value);
			const parsed = avccTags(buffer);
			buffer = parsed.rest;
			for (const tag of parsed.tags) tags.add(tag);
		}
		await reader.cancel();
		return tags;
	} finally {
		clearTimeout(timeout);
	}
}

describeConfigured("native stream lifecycle", () => {
	let server: OwnedE2EServer;
	let releaseLock = () => {};

	beforeAll(async () => {
		releaseLock = await acquireIosSimulatorTestLock(explicitIosDevice!);
		server = await startOwnedE2EServer();
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	afterAll(async () => {
		try {
			await server?.stop();
		} finally {
			releaseLock();
		}
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	test("produces real frames and shuts down its owned server", async () => {
		const helper = `${server.origin}/helper/${encodeURIComponent(explicitIosDevice!)}`;
		const jpeg = await firstMjpeg(`${helper}/stream.mjpeg`);
		expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

		const tags = await requiredAvccTags(`${helper}/stream.avcc`);
		expect(tags.has(TAG_DESCRIPTION)).toBe(true);
		expect(tags.has(TAG_KEYFRAME)).toBe(true);

		await server.stop();
		await expect(fetch(`${server.origin}/status`)).rejects.toBeDefined();
	}, STREAM_DEADLINE_MS * 2 + 10_000);
});
