import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { encode as encodePng } from "fast-png";
import {
	captureDeviceScreenshot,
	findOnDevice,
	observeDevice,
	type ObservationSession,
} from "../../../../../core/tools/observe/observe";
import { capturedImage } from "../../../../../core/tools/observe/capture";
import { createSnapshotStore } from "../../../../../core/tools/observe/snapshot-store";

const DEVICE = "android:emulator-5554";

const snapshot = {
	screen: { width: 100, height: 200 },
	elements: [
		{
			id: "button",
			path: "0",
			label: "Continue",
			value: "",
			role: "android.widget.Button",
			type: "android.widget.Button",
			enabled: true,
			frame: { x: 10, y: 20, width: 30, height: 40 },
		},
	],
};

function png(
	width: number,
	height: number,
	data = new Uint8Array(width * height).fill(1),
): Buffer {
	return Buffer.from(encodePng({ width, height, channels: 1, data }));
}

function setup(overrides: {
	accessibility?: () => Promise<unknown>;
	image?: () => Promise<{
		bytes: Buffer;
		mimeType: string;
		capturedAt: number;
		width?: number;
		height?: number;
	}>;
	config?: () => Promise<unknown>;
}) {
	const store = createSnapshotStore();
	let accessibilityReads = 0;
	let foregroundReads = 0;
	const session: ObservationSession = {
		platform: "android",
		readAccessibility: async () => {
			accessibilityReads += 1;
			return overrides.accessibility
				? overrides.accessibility()
				: snapshot;
		},
		captureScreenshot: () =>
			overrides.image
				? overrides.image()
				: Promise.resolve({
						bytes: png(300, 600),
						mimeType: "image/png",
						capturedAt: 200,
					}),
		readConfig: () =>
			overrides.config
				? overrides.config()
				: Promise.resolve({
						width: 300,
						height: 600,
						orientation: "portrait",
						presentationGeneration: 4,
					}),
	};
	return {
		store,
		accessibilityReads: () => accessibilityReads,
		foregroundReads: () => foregroundReads,
		dependencies: {
			store,
			resolveSession: () => Effect.succeed(session),
			readForegroundApp: () =>
				Effect.sync(() => {
					foregroundReads += 1;
					return "com.example.app";
				}),
		},
	};
}

describe("paired observation capture", () => {
	test("does not publish accessibility read before a mutation", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const test = setup({
			accessibility: async () => {
				entered.resolve();
				await release.promise;
				return snapshot;
			},
		});
		const pending = Effect.runPromise(observeDevice(test.dependencies, DEVICE));
		await entered.promise;
		test.store.mutate(DEVICE);
		release.resolve();
		const result = await pending;

		expect(result.accessibility).toMatchObject({
			status: "error",
			error: "The accessibility read expired before publication",
		});
		expect(test.store.current(DEVICE)).toBeNull();
	});

	test("an older overlapping read cannot replace a newer observation", async () => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		let reads = 0;
		const test = setup({
			accessibility: async () => {
				reads += 1;
				if (reads === 1) {
					entered.resolve();
					await release.promise;
				}
				return snapshot;
			},
		});
		const older = Effect.runPromise(observeDevice(test.dependencies, DEVICE));
		await entered.promise;
		const newer = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);
		release.resolve();
		const expired = await older;

		expect(newer.accessibility.status).toBe("ok");
		expect(expired.accessibility.status).toBe("error");
		expect(test.store.current(DEVICE)).toBe(newer.view);
	});

	test("keeps the image when accessibility fails", async () => {
		const test = setup({
			accessibility: async () => {
				throw new Error("AX unavailable");
			},
		});

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.accessibility).toMatchObject({
			status: "error",
			error: "AX unavailable",
		});
		expect(result.image).toMatchObject({
			status: "ok",
			value: { captureId: "c1", observationId: null },
		});
		expect(test.store.resolveCapture(DEVICE, "c1")).toMatchObject({
			ok: true,
			capture: { observation: null },
		});
	});

	test("keeps accessibility when the image fails and fails the capture ID", async () => {
		const test = setup({
			image: async () => {
				throw new Error("image unavailable");
			},
		});

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.accessibility).toMatchObject({
			status: "ok",
			value: { observationId: "s1" },
		});
		expect(result.image).toMatchObject({
			status: "error",
			error: "image unavailable",
		});
		expect(result.captureId).toBeNull();
	});

	test("reports malformed accessibility without dropping the image", async () => {
		const test = setup({
			accessibility: async () => ({
				screen: { width: 100, height: 200 },
				elements: [{ id: "missing-fields" }],
			}),
		});

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.accessibility).toMatchObject({
			status: "error",
			error: "The accessibility tree is malformed",
		});
		expect(result.image.status).toBe("ok");
		expect(result.view).toBeNull();
	});

	test("keeps both channels when the screen config fails", async () => {
		const test = setup({
			config: async () => {
				throw new Error("config unavailable");
			},
		});

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.accessibility.status).toBe("ok");
		expect(result.image.status).toBe("ok");
		expect(result.context).toMatchObject({
			orientation: null,
			generation: null,
			before: { status: "error", error: "config unavailable" },
			after: { status: "error", error: "config unavailable" },
		});
		expect(result.image).toMatchObject({
			status: "ok",
			value: { captureId: null },
		});
	});

	test("does not pair channels across an orientation or generation change", async () => {
		const configs = [
			{
				width: 300,
				height: 600,
				orientation: "portrait",
				presentationGeneration: 4,
			},
			{
				width: 600,
				height: 300,
				orientation: "landscape",
				presentationGeneration: 5,
			},
		];
		const test = setup({ config: async () => configs.shift() });

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.observationId).toBe("s1");
		expect(result.context).toMatchObject({
			orientation: "landscape",
			generation: 5,
			changedDuringCapture: true,
		});
		expect(result.image).toMatchObject({
			status: "ok",
			value: { captureId: null, observationId: null },
		});
		expect(result.captureId).toBeNull();
		expect(result.warnings).toContain(
			"The screen changed during capture. The image is not paired with the accessibility tree.",
		);
	});

	test("reports encoded dimensions, MIME type, and channel times", async () => {
		const bytes = png(321, 654);
		const test = setup({
			image: async () => ({
				bytes,
				mimeType: "image/png",
				capturedAt: 1_234,
				width: 1,
				height: 1,
			}),
		});

		const result = await Effect.runPromise(
			observeDevice(test.dependencies, DEVICE),
		);

		expect(result.image).toMatchObject({
			status: "ok",
			capturedAt: 1_234,
			value: {
				bytes,
				mimeType: "image/png",
				width: 321,
				height: 654,
			},
		});
		expect(result.accessibility.capturedAt).toBeNumber();
		expect(result.startedAt).toBeLessThanOrEqual(result.completedAt);
	});
});

describe("pure screenshot capture", () => {
	test("does not read accessibility and publishes an unbound capture", async () => {
		const test = setup({});

		const result = await Effect.runPromise(
			captureDeviceScreenshot(test.dependencies, DEVICE),
		);

		expect(test.accessibilityReads()).toBe(0);
		expect(test.foregroundReads()).toBe(0);
		expect(result).toMatchObject({
			observationId: null,
			captureId: "c1",
			image: {
				status: "ok",
				value: {
					captureId: "c1",
					observationId: null,
				},
			},
			context: {
				app: null,
				orientation: "portrait",
				generation: 4,
			},
		});
		expect(test.store.resolveCapture(DEVICE, "c1")).toMatchObject({
			ok: true,
			capture: {
				screen: { width: 300, height: 600 },
				orientation: "portrait",
			},
		});
	});
});

describe("find", () => {
	test("validates the query and reads no image", async () => {
		const test = setup({
			image: async () => {
				throw new Error("find must not capture an image");
			},
		});
		const result = await Effect.runPromise(
			findOnDevice(test.dependencies, DEVICE, "Continue"),
		);

		expect(result.query).toBe("Continue");
		expect(result.nodes).toHaveLength(1);
		expect(result.nodes[0]?.label).toBe("Continue");
		await expect(
			Effect.runPromise(findOnDevice(test.dependencies, DEVICE, "  ")),
		).rejects.toThrow("A search text is required");
	});
});

test("reads dimensions from an iOS JPEG frame", () => {
	const bytes = Buffer.from([
		0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x02, 0x8e, 0x01, 0x41, 0x01,
		0x01, 0x11, 0x00,
	]);

	expect(
		capturedImage({ bytes, mimeType: "image/jpeg", capturedAt: 1 }),
	).toEqual({
		bytes,
		mimeType: "image/jpeg",
		width: 321,
		height: 654,
	});
});

describe("image validation", () => {
	test("rejects an unsupported image format", () => {
		expect(() =>
			capturedImage({
				bytes: Buffer.from("image"),
				mimeType: "image/webp",
				capturedAt: 1,
			}),
		).toThrow("format is not supported");
	});

	test("rejects a corrupt PNG", () => {
		const bytes = png(2, 2).subarray(0, 30);

		expect(() =>
			capturedImage({ bytes, mimeType: "image/png", capturedAt: 1 }),
		).toThrow("The PNG screenshot is invalid");
	});

	test("reports invalid PNG data as an image error", async () => {
		const test = setup({
			image: async () => ({
				bytes: Buffer.from("not a PNG"),
				mimeType: "image/png",
				capturedAt: 1_234,
			}),
		});

		const result = await Effect.runPromise(
			captureDeviceScreenshot(test.dependencies, DEVICE),
		);

		expect(result.image).toEqual({
			status: "error",
			capturedAt: 1_234,
			error: "The PNG screenshot is invalid",
		});
		expect(result.captureId).toBeNull();
	});
});
