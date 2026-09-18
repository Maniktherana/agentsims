import { describe, expect, test } from "bun:test";
import { readEmulatorFrameBuffer } from "../../../../../core/android/stream/emulator-controller";

const PATH = "/tmp/agentsims-fake.rgba";

/** A fake shared-memory buffer: the emulator writes RGBA, we read a prefix. */
function fakeBuffer(bytes: Uint8Array) {
	const reads: Array<{ path: string; length: number }> = [];
	return {
		reads,
		read: (path: string, length: number) => {
			reads.push({ path, length });
			return bytes.length >= length ? bytes.subarray(0, length) : null;
		},
	};
}

describe("emulator frame buffer", () => {
	test("copies the frame the configuration describes", () => {
		const bytes = new Uint8Array(4 * 3 * 4);
		for (let index = 0; index < bytes.length; index += 1) bytes[index] = index;
		const buffer = fakeBuffer(bytes);

		const frame = readEmulatorFrameBuffer(PATH, 4, 3, buffer.read);

		expect(frame).not.toBeNull();
		expect({ width: frame!.width, height: frame!.height }).toEqual({
			width: 4,
			height: 3,
		});
		expect(frame!.rgba).toHaveLength(48);
		expect(Array.from(frame!.rgba.subarray(0, 4))).toEqual([0, 1, 2, 3]);
		expect(buffer.reads).toEqual([{ path: PATH, length: 48 }]);
	});

	test("reads only the newest frame, not the whole file", () => {
		// The file keeps the size the stream requested. A rotated frame is
		// smaller, so the read must stop at the frame it was told about.
		const buffer = fakeBuffer(new Uint8Array(1000).fill(7));

		const frame = readEmulatorFrameBuffer(PATH, 10, 5, buffer.read);

		expect(frame!.rgba).toHaveLength(200);
		expect(buffer.reads[0]!.length).toBe(200);
	});

	test("answers null for a short read or an impossible size", () => {
		const short = fakeBuffer(new Uint8Array(8));
		expect(readEmulatorFrameBuffer(PATH, 4, 3, short.read)).toBeNull();
		const any = fakeBuffer(new Uint8Array(64));
		expect(readEmulatorFrameBuffer(PATH, 0, 3, any.read)).toBeNull();
		expect(readEmulatorFrameBuffer(PATH, 4, -1, any.read)).toBeNull();
		expect(readEmulatorFrameBuffer(PATH, 1.5, 3, any.read)).toBeNull();
		expect(any.reads).toEqual([]);
	});

	test("answers null when the buffer file cannot be read", () => {
		expect(
			readEmulatorFrameBuffer("/directory-that-does-not-exist/frame.rgba", 2, 2),
		).toBeNull();
	});
});
