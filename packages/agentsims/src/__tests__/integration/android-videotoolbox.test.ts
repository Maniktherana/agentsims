import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const addonPath = resolve(
	import.meta.dir,
	"../../../dist/native/agentsims-native.node",
);
test.skipIf(process.platform !== "darwin")(
	"VideoToolbox emits Android H.264, honors keyframe requests, resizes, and awaits shutdown",
	async () => {
		if (!existsSync(addonPath))
			throw new Error(
				`The iOS native addon is missing: ${addonPath}. Build it before this native test.`,
			);
		const { AndroidVideoCapture } = createRequire(import.meta.url)(addonPath);
		const directory = mkdtempSync(join(tmpdir(), "agentsims-videotoolbox-"));
		const path = join(directory, "rgba");
		const rgba = Buffer.alloc(64 * 96 * 4);
		for (let i = 0; i < rgba.length; i += 4) {
			rgba.set([210, 40, 75, 255], i);
		}
		writeFileSync(path, rgba);
		const frames: Array<[Uint8Array, number, number, number]> = [];
		const capture = new AndroidVideoCapture(
			path,
			(frame: (typeof frames)[number]) => frames.push(frame),
		);
		const waitForKeyframe = async (width: number, height: number) => {
			const until = performance.now() + 5000;
			while (
				!frames.some(
					([, w, h, flags]) => w === width && h === height && flags === 2,
				)
			) {
				if (performance.now() > until)
					throw new Error("No VideoToolbox keyframe arrived");
				await Bun.sleep(10);
			}
			expect(frames[0]![3]).toBe(1);
			expect(frames[0]![0][4]).toBe(1);
			expect(frames[0]![0][5]).toBe(1); // avcC version, not a codec-name marker.
			expect(frames.at(-1)![0][4]).toBe(2);
		};
		try {
			await capture.frame(64, 96);
			await waitForKeyframe(64, 96);
			const saved = Buffer.from(frames[0]![0]);
			const firstDescription = frames[0]![0];
			frames.length = 0;
			await capture.requestKeyframe();
			await capture.frame(64, 96);
			await waitForKeyframe(64, 96);
			expect(Buffer.from(firstDescription)).toEqual(saved);
			frames.length = 0;
			await capture.frame(96, 64);
			await waitForKeyframe(96, 64);
			await capture.frame(64, 96);
			await capture.stop();
			const stoppedCount = frames.length;
			await capture.frame(64, 96);
			await Bun.sleep(30);
			expect(frames.length).toBe(stoppedCount);
		} finally {
			await capture.stop();
			rmSync(directory, { recursive: true, force: true });
		}
	},
	20_000,
);
