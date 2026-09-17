import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactPortal } from "react";
import {
	ScreenshotPreviewOverlay,
	ScreenshotFlash,
	copyScreenshotBlob,
	resolveScreenshotPreviewSidecar,
	screenshotPreviewSourceTransform,
} from "../../../../../web/components/simulator/screenshot-preview";

describe("device screenshot feedback", () => {
	test("places the preview to the preferred right of the screen with bottom edges aligned", () => {
		expect(
			resolveScreenshotPreviewSidecar({
				screen: { left: 200, top: 60, width: 300, height: 600 },
				capture: { width: 1200, height: 2400 },
				viewport: { width: 1000, height: 1000 },
			}),
		).toEqual({
			side: "right",
			left: 514,
			top: 460,
			width: 100,
			height: 200,
			sourceLeft: 200,
			sourceTop: 60,
			sourceWidth: 300,
			sourceHeight: 600,
		});
	});

	test("falls back to the left and safely scales without changing capture aspect", () => {
		const placement = resolveScreenshotPreviewSidecar({
			screen: { left: 600, top: 60, width: 300, height: 600 },
			capture: { width: 2400, height: 1200 },
			viewport: { width: 1000, height: 900 },
		});

		expect(placement?.side).toBe("left");
		expect(placement?.height).toBeLessThanOrEqual(200);
		expect(placement!.width / placement!.height).toBeCloseTo(2, 8);
		expect(placement!.top + placement!.height).toBe(660);
		expect(placement!.left + placement!.width).toBeLessThanOrEqual(586);
	});

	test("starts exactly over the captured screen even after the canvas has moved", () => {
		const capturedScreen = {
			left: 201.25,
			top: 82.5,
			width: 301.5,
			height: 675.3,
		};
		const placement = resolveScreenshotPreviewSidecar({
			screen: { left: 270, top: 100, width: 350, height: 700 },
			capture: { width: 1080, height: 2424 },
			viewport: { width: 1400, height: 1000 },
		})!;
		const transform = screenshotPreviewSourceTransform(
			placement,
			capturedScreen,
		);
		expect(placement.left + transform.x).toBe(capturedScreen.left);
		expect(placement.top + transform.y).toBe(capturedScreen.top);
		expect(placement.width * transform.scaleX).toBeCloseTo(
			capturedScreen.width,
			8,
		);
		expect(placement.height * transform.scaleY).toBeCloseTo(
			capturedScreen.height,
			8,
		);
	});

	test("keeps a tall phone's preview inside the viewport without changing its source geometry", () => {
		const placement = resolveScreenshotPreviewSidecar({
			screen: { left: 200, top: 60, width: 528, height: 1056 },
			capture: { width: 528, height: 1056 },
			viewport: { width: 1000, height: 720 },
		});
		expect(placement).toMatchObject({
			side: "right",
			left: 742,
			top: 344,
			width: 176,
			height: 352,
			sourceLeft: 200,
			sourceTop: 60,
			sourceWidth: 528,
			sourceHeight: 1056,
		});
		expect(placement!.top + placement!.height).toBe(696);
		expect(placement!.width / placement!.height).toBe(0.5);
	});

	test("uses space beside the image now that controls fit inside it", () => {
		const placement = resolveScreenshotPreviewSidecar({
			screen: { left: 24, top: 24, width: 300, height: 600 },
			capture: { width: 300, height: 600 },
			viewport: { width: 450, height: 720 },
		});
		expect(placement?.side).toBe("right");
		expect(placement?.width).toBe(88);
		expect(placement?.height).toBe(176);
	});

	test("does not show a preview when neither side has space", () => {
		expect(
			resolveScreenshotPreviewSidecar({
				screen: { left: 0, top: 0, width: 320, height: 640 },
				capture: { width: 1080, height: 2424 },
				viewport: { width: 320, height: 640 },
			}),
		).toBeNull();
	});

	test("renders accessible controls and the captured image", () => {
		const html = renderToStaticMarkup(
			<ScreenshotPreviewOverlay
				deviceId="android:emulator-5554"
				preview={{
					id: "shot-2",
					src: "blob:shot-2",
					width: 1080,
					height: 2424,
					phase: "visible",
					copying: false,
					error: null,
					source: {
						left: 0,
						top: 0,
						width: 360,
						height: 808,
						borderRadius: "14% 14% 10% 10% / 6% 6% 4% 4%",
						cornerShape: "round",
					},
				}}
				layout={{
					side: "right",
					left: 120,
					top: 451,
					width: 120,
					height: 269,
					sourceLeft: 0,
					sourceTop: 0,
					sourceWidth: 360,
					sourceHeight: 808,
				}}
				onCopy={() => {}}
				onDismiss={() => {}}
			/>,
		);

		expect(html).toContain('aria-label="Copy image"');
		expect(html).toContain('aria-label="Close screenshot"');
		expect(html).toContain("width:120px");
		expect(html).toContain("height:269px");
		expect(html).toContain('src="blob:shot-2"');
	});

	test("portals above phone stacking contexts using viewport coordinates", () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
		const body = { nodeType: 1 };
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: { body },
		});
		try {
			const portal = ScreenshotPreviewOverlay({
				deviceId: "phone",
				preview: {
					id: "shot",
					src: "blob:shot",
					width: 300,
					height: 600,
					phase: "enter",
					copying: false,
					error: null,
				},
				layout: resolveScreenshotPreviewSidecar({
					screen: { left: 200, top: 60, width: 300, height: 600 },
					capture: { width: 300, height: 600 },
					viewport: { width: 1000, height: 1000 },
				}),
				onCopy: () => {},
				onDismiss: () => {},
			}) as ReactPortal & { containerInfo: unknown };
			expect(portal.containerInfo).toBe(body);
			const html = renderToStaticMarkup(portal.children as ReactElement);
			expect(html).toContain("left:514px");
			expect(html).toContain("top:460px");
			expect(html).toContain(
				"translateX(-314px) translateY(-400px) scaleX(3) scaleY(3)",
			);
		} finally {
			if (previous) Object.defineProperty(globalThis, "document", previous);
			else Reflect.deleteProperty(globalThis, "document");
		}
	});

	test("keeps error messages out of the screenshot thumbnail", () => {
		const html = renderToStaticMarkup(
			<ScreenshotPreviewOverlay
				deviceId="ios:phone"
				preview={{
					id: "shot-3",
					src: "blob:shot-3",
					width: 100,
					height: 200,
					phase: "visible",
					copying: false,
					error: "Clipboard permission denied",
				}}
				layout={{
					side: "left",
					left: 10,
					top: 20,
					width: 100,
					height: 200,
					sourceLeft: 100,
					sourceTop: 100,
					sourceWidth: 200,
					sourceHeight: 400,
				}}
				onCopy={() => {}}
				onDismiss={() => {}}
			/>,
		);

		expect(html).not.toContain('role="alert"');
		expect(html).not.toContain("Clipboard permission denied");
		expect(html).toContain('aria-label="Copy image"');
	});

	test("writes a PNG ClipboardItem through the async clipboard API", async () => {
		const blob = new Blob(["png"], { type: "image/png" });
		const writes: Array<Array<{ data: Record<string, Blob> }>> = [];
		await copyScreenshotBlob(
			blob,
			{
				write: async (items) => {
					writes.push(items);
				},
			},
			(data) => ({ data }),
		);

		expect(writes).toHaveLength(1);
		expect(writes[0]?.[0]?.data["image/png"]).toBe(blob);
	});

	test("keeps the flash unable to intercept simulator input", () => {
		const html = renderToStaticMarkup(
			<ScreenshotFlash
				deviceId="ios:phone"
				flash={{ id: "flash-3", phase: "fading" }}
				borderRadius="12% / 6%"
			/>,
		);

		expect(html).toContain("pointer-events-none");
	});
});
