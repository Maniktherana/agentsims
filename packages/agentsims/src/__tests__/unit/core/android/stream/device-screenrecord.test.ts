import { describe, expect, test } from "bun:test";
import { ScreenrecordAvccParser } from "../../../../../core/android/stream/device-screenrecord";

const startCode = Buffer.from([0, 0, 0, 1]);

function annexB(...nals: Buffer[]): Buffer {
	return Buffer.concat(nals.flatMap((nal) => [startCode, nal]));
}

describe("ADB screenrecord H.264 parser", () => {
	test("does not truncate a keyframe when an ADB chunk is delayed", async () => {
		const published: Buffer[] = [];
		const parser = new ScreenrecordAvccParser((chunk) => published.push(chunk));

		parser.push(
			annexB(
				Buffer.from([0x67, 0x64, 0x00, 0x2a, 0xac]),
				Buffer.from([0x68, 0xee, 0x3c, 0x80]),
				Buffer.from([0x65, 0x80, 0x11]),
			),
		);

		await Bun.sleep(10);

		expect(published.map((chunk) => chunk[4])).toEqual([0x01]);
		parser.push(Buffer.from([0x22, 0x33]));
		parser.push(annexB(Buffer.from([0x09, 0xf0]), Buffer.from([0x41, 0x80])));
		expect(published.map((chunk) => chunk[4])).toEqual([0x01, 0x02]);
		expect(published[1]!.subarray(9)).toEqual(
			Buffer.from([0x65, 0x80, 0x11, 0x22, 0x33]),
		);
	});

	test("does not publish an incomplete final slice after the idle interval", async () => {
		const published: Buffer[] = [];
		const parser = new ScreenrecordAvccParser((chunk) => published.push(chunk));

		parser.push(
			annexB(
				Buffer.from([0x67, 0x64, 0x00, 0x2a, 0xac]),
				Buffer.from([0x68, 0xee, 0x3c, 0x80]),
				Buffer.from([0x65]),
			),
		);

		await Bun.sleep(10);

		expect(published.map((chunk) => chunk[4])).toEqual([0x01]);
	});
});
