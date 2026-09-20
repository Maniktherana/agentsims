import { describe, expect, test } from "bun:test";
import {
	CAMERA_HEIC_ERROR,
	CAMERA_LARGE_VIDEO_BYTES,
	CAMERA_POLL_INTERVAL_MS,
	cameraSourceErrorMessage,
	isHeicLikeFile,
	isOversizedCameraVideo,
	nextCameraPillState,
	selectCameraPrimaryKind,
} from "../../../../../../web/components/dock/settings/camera-tool";

describe("nextCameraPillState", () => {
	test("ready stays ready on dead poll", () => {
		expect(nextCameraPillState("ready", false)).toBe("ready");
	});
	test("ready becomes active when poll says alive", () => {
		expect(nextCameraPillState("ready", true)).toBe("active");
	});
	test("active degrades to disconnected on first dead poll", () => {
		expect(nextCameraPillState("active", false)).toBe("disconnected");
	});
	test("active stays active when poll says alive", () => {
		expect(nextCameraPillState("active", true)).toBe("active");
	});
	test("disconnected drops to ready on second consecutive dead poll", () => {
		expect(nextCameraPillState("disconnected", false)).toBe("ready");
	});
	test("disconnected recovers to active if poll says alive again", () => {
		expect(nextCameraPillState("disconnected", true)).toBe("active");
	});
});

describe("selectCameraPrimaryKind", () => {
	test("no foreground bundle, helper not alive: Play", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: null,
				injected: false,
				source: "placeholder",
				foregroundIsInjected: false,
			}),
		).toBe("play");
	});

	test("foreground bundle, helper not alive: Play", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: false,
				source: "webcam",
				foregroundIsInjected: false,
			}),
		).toBe("play");
	});

	test("helper alive but no real source picked: Play (not Stop)", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: true,
				source: "placeholder",
				foregroundIsInjected: true,
			}),
		).toBe("play");
	});

	test("helper alive with real source, foreground app not yet injected: Inject", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: true,
				source: "webcam",
				foregroundIsInjected: false,
			}),
		).toBe("attach");
	});

	test("helper alive with real source, foreground app injected: Stop", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: true,
				source: "webcam",
				foregroundIsInjected: true,
			}),
		).toBe("stop");
	});

	test("page reload mid-injection (helper alive, real source, bundle not yet detected): Stop", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: null,
				injected: true,
				source: "webcam",
				foregroundIsInjected: false,
			}),
		).toBe("stop");
	});

	test("image source counts as a real source", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: true,
				source: "image",
				foregroundIsInjected: true,
			}),
		).toBe("stop");
	});

	test("video source counts as a real source", () => {
		expect(
			selectCameraPrimaryKind({
				bundleId: "com.example.app",
				injected: true,
				source: "video",
				foregroundIsInjected: true,
			}),
		).toBe("stop");
	});
});

describe("isOversizedCameraVideo", () => {
	test("flags videos above 200MB", () => {
		expect(
			isOversizedCameraVideo({
				type: "video/mp4",
				size: CAMERA_LARGE_VIDEO_BYTES + 1,
			}),
		).toBe(true);
	});
	test("ignores videos at exactly 200MB (must exceed)", () => {
		expect(
			isOversizedCameraVideo({
				type: "video/mp4",
				size: CAMERA_LARGE_VIDEO_BYTES,
			}),
		).toBe(false);
	});
	test("ignores small videos", () => {
		expect(
			isOversizedCameraVideo({ type: "video/mp4", size: 10 * 1024 * 1024 }),
		).toBe(false);
	});
	test("ignores large images", () => {
		expect(
			isOversizedCameraVideo({
				type: "image/jpeg",
				size: CAMERA_LARGE_VIDEO_BYTES + 1,
			}),
		).toBe(false);
	});
	test("falls back to extension for videos with missing mime", () => {
		expect(
			isOversizedCameraVideo({
				type: "",
				name: "clip.mov",
				size: CAMERA_LARGE_VIDEO_BYTES + 1,
			}),
		).toBe(true);
	});
});

describe("isHeicLikeFile", () => {
	test("detects image/heic mime", () => {
		expect(isHeicLikeFile({ type: "image/heic", name: "x" })).toBe(true);
	});
	test("detects image/heif mime", () => {
		expect(isHeicLikeFile({ type: "image/heif", name: "x" })).toBe(true);
	});
	test("detects .heic extension when mime is empty", () => {
		expect(isHeicLikeFile({ type: "", name: "photo.HEIC" })).toBe(true);
	});
	test("detects .heif extension when mime is empty", () => {
		expect(isHeicLikeFile({ type: "", name: "photo.heif" })).toBe(true);
	});
	test("ignores jpeg", () => {
		expect(isHeicLikeFile({ type: "image/jpeg", name: "photo.jpg" })).toBe(
			false,
		);
	});
});

describe("cameraSourceErrorMessage", () => {
	test("maps HEIC image failures to actionable copy", () => {
		expect(
			cameraSourceErrorMessage({
				rawMessage: "could not decode image",
				lastFileIsHeic: true,
				source: "image",
			}),
		).toBe(CAMERA_HEIC_ERROR);
	});

	test("maps HEIC video/file failures while source is video", () => {
		expect(
			cameraSourceErrorMessage({
				rawMessage: "reader failed",
				lastFileIsHeic: true,
				source: "video",
			}),
		).toBe(CAMERA_HEIC_ERROR);
	});

	test("preserves non-HEIC file errors", () => {
		expect(
			cameraSourceErrorMessage({
				rawMessage: "reader failed",
				lastFileIsHeic: false,
				source: "video",
			}),
		).toBe("reader failed");
	});

	test("does not rewrite webcam errors with stale HEIC state", () => {
		expect(
			cameraSourceErrorMessage({
				rawMessage: "no matching camera",
				lastFileIsHeic: true,
				source: "webcam",
			}),
		).toBe("no matching camera");
	});

	test("does not rewrite placeholder errors with stale HEIC state", () => {
		expect(
			cameraSourceErrorMessage({
				rawMessage: "helper stopped",
				lastFileIsHeic: true,
				source: "placeholder",
			}),
		).toBe("helper stopped");
	});
});

describe("CAMERA_POLL_INTERVAL_MS", () => {
	test("falls in the requested 2–5s window", () => {
		expect(CAMERA_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
		expect(CAMERA_POLL_INTERVAL_MS).toBeLessThanOrEqual(5000);
	});
});
