import { describe, expect, test } from "bun:test";
import { startScreenshotCapture } from "../../../../../web/simulator/screenshot/screenshot-capture-flow";

const optimistic = {
	id: "optimistic",
	src: "data:image/png;base64,AAAA",
	width: 1080,
	height: 2424,
	blob: new Blob(["optimistic"], { type: "image/png" }),
	save: () => {},
};

describe("screenshot capture flow", () => {
	test("shows the current rendered surface before a delayed native capture resolves", async () => {
		const events: string[] = [];
		let resolveNative!: (value: typeof optimistic) => void;
		const native = new Promise<typeof optimistic>((resolve) => {
			resolveNative = resolve;
		});

		const flow = startScreenshotCapture({
			capturePresentedSurface: () => optimistic,
			begin: (capture) => {
				events.push(`begin:${capture.src}`);
				return 7;
			},
			captureAuthoritative: () => {
				events.push("native:start");
				return native;
			},
			replace: (requestId, capture) => {
				events.push(`replace:${requestId}:${capture.src}`);
			},
			reportError: (message) => events.push(`error:${message}`),
		});

		expect(events).toEqual([
			"begin:data:image/png;base64,AAAA",
			"native:start",
		]);
		expect(flow?.requestId).toBe(7);

		resolveNative({ ...optimistic, src: "blob:native" });
		await flow?.done;
		expect(events.at(-1)).toBe("replace:7:blob:native");
	});
});
