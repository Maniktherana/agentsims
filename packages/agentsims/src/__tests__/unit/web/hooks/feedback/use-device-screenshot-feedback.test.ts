import { describe, expect, test } from "bun:test";
import {
	PREVIEW_READY_COUNTDOWN_MS,
	ScreenshotCaptureSession,
	ScreenshotPreviewCountdown,
	ScreenshotSaveCoordinator,
	completeScreenshotPreview,
	replaceScreenshotCapture,
} from "../../../../../web/hooks/simulator/use-screenshot-preview";

const blob = new Blob(["png"], { type: "image/png" });

describe("ScreenshotCaptureSession", () => {
	test("accepts only the latest capture and releases stale object URLs", () => {
		const session = new ScreenshotCaptureSession();
		const first = session.begin();
		const second = session.begin();
		let released = 0;

		expect(
			session.accept(first, {
				id: "first",
				src: "blob:first",
				width: 100,
				height: 200,
				blob,
				save: () => {},
				release: () => {
					released += 1;
				},
			}),
		).toBeNull();
		expect(released).toBe(1);

		const latest = {
			id: "second",
			src: "blob:second",
			width: 100,
			height: 200,
			blob,
			save: () => {},
		};
		expect(session.accept(second, latest)).toBe(latest);
	});

	test("keeps simultaneous devices isolated", () => {
		const iphone = new ScreenshotCaptureSession();
		const android = new ScreenshotCaptureSession();
		const iphoneRequest = iphone.begin();
		const androidRequest = android.begin();
		iphone.begin();

		const androidCapture = {
			id: "pixel-shot",
			src: "blob:pixel-shot",
			width: 1080,
			height: 2424,
			blob,
			save: () => {},
		};
		expect(android.accept(androidRequest, androidCapture)).toBe(androidCapture);
		expect(
			iphone.accept(iphoneRequest, {
				id: "old-iphone-shot",
				src: "data:image/png;base64,AAAA",
				width: 1206,
				height: 2622,
				blob,
				save: () => {},
			}),
		).toBeNull();
	});

	test("rejects captures that finish after unmount invalidation", () => {
		const session = new ScreenshotCaptureSession();
		const request = session.begin();
		let released = false;
		session.invalidate();

		expect(
			session.accept(request, {
				id: "late",
				src: "blob:late",
				width: 1,
				height: 1,
				blob,
				save: () => {},
				release: () => {
					released = true;
				},
			}),
		).toBeNull();
		expect(released).toBe(true);
	});

	test("starts the save countdown only when told the preview is ready", async () => {
		const countdown = new ScreenshotPreviewCountdown();
		let saves = 0;
		countdown.ready(() => {
			saves += 1;
		}, 2);
		expect(saves).toBe(0);
		await Bun.sleep(8);
		expect(saves).toBe(1);
		expect(PREVIEW_READY_COUNTDOWN_MS).toBe(5000);
	});

	test("copy, discard, or a newer capture can cancel pending save", async () => {
		const countdown = new ScreenshotPreviewCountdown();
		let saves = 0;
		countdown.ready(() => {
			saves += 1;
		}, 2);
		countdown.cancel();
		await Bun.sleep(8);
		expect(saves).toBe(0);
	});

	test("saves and releases an unplaced preview after the countdown", async () => {
		const countdown = new ScreenshotPreviewCountdown();
		const coordinator = new ScreenshotSaveCoordinator();
		let saves = 0;
		let releases = 0;
		let active: {
			id: string;
			save: () => void;
			release: () => void;
		} | null = {
			id: "unplaced-shot",
			save: () => {
				saves += 1;
			},
			release: () => {
				releases += 1;
			},
		};

		countdown.ready(
			() =>
				completeScreenshotPreview({
					id: "unplaced-shot",
					getActive: () => active,
					saveCoordinator: coordinator,
					hasVisualPlacement: () => false,
					onExit: () => {
						throw new Error(
							"an unplaced preview must not animate a hidden exit",
						);
					},
					onRemove: () => {
						active?.release();
						active = null;
					},
					onError: () => {
						throw new Error("save unexpectedly failed");
					},
				}),
			2,
		);

		await Bun.sleep(12);
		expect(saves).toBe(1);
		expect(releases).toBe(1);
		expect(active).toBeNull();
	});

	test("releases an unplaced preview when its controlled save fails", async () => {
		const coordinator = new ScreenshotSaveCoordinator();
		let released = false;
		const active = {
			id: "failed-unplaced-shot",
			save: () => {
				throw new Error("disk full");
			},
		};

		await completeScreenshotPreview({
			id: active.id,
			getActive: () => active,
			saveCoordinator: coordinator,
			hasVisualPlacement: () => false,
			onExit: () => {
				throw new Error("an unplaced preview must not animate a hidden exit");
			},
			onRemove: () => {
				released = true;
			},
			onError: () => {
				throw new Error("an invisible preview cannot expose an error action");
			},
		});

		expect(released).toBe(true);
	});

	test("authoritative capture replaces pixels without changing geometry, identity, or deadline", () => {
		const optimistic = {
			id: "shot-1",
			src: "data:image/png;base64,optimistic",
			width: 1080,
			height: 2424,
			blob,
			phase: "visible" as const,
			copying: false,
			error: null,
			save: () => {},
		};
		const replacement = replaceScreenshotCapture(optimistic, {
			id: "native-id-must-not-win",
			src: "blob:native",
			width: 2424,
			height: 1080,
			blob: new Blob(["native"], { type: "image/png" }),
			save: () => {},
		});

		expect(replacement.id).toBe("shot-1");
		expect(replacement.width).toBe(1080);
		expect(replacement.height).toBe(2424);
		expect(replacement.src).toBe("blob:native");
	});

	test("cancels an in-flight controlled host save", async () => {
		const coordinator = new ScreenshotSaveCoordinator();
		let observedAbort = false;
		const save = coordinator.run(
			"shot-1",
			(signal) =>
				new Promise<void>((resolve) => {
					signal.addEventListener(
						"abort",
						() => {
							observedAbort = true;
							resolve();
						},
						{ once: true },
					);
				}),
		);

		expect(coordinator.cancel("shot-1")).toBe(true);
		await expect(save).rejects.toHaveProperty("name", "AbortError");
		expect(observedAbort).toBe(true);
	});
});
