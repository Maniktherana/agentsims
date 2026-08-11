import { Copy, X } from "lucide-react";
import type { CSSProperties } from "react";

export type ScreenshotPreviewSide = "right" | "left";

export type ScreenshotPreview = {
  id: string;
  src: string;
  width: number;
  height: number;
  phase: "enter" | "visible" | "exit";
  copying: boolean;
  error: string | null;
};

export type ScreenshotFlashState = {
  id: string;
  phase: "solid" | "fading";
};

export type ScreenshotPreviewLayout = {
  side: ScreenshotPreviewSide;
  left: number;
  top: number;
  width: number;
  height: number;
};

type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ScreenshotSize = {
  width: number;
  height: number;
};

const SCREENSHOT_PREVIEW_GAP = 14;
const SCREENSHOT_PREVIEW_VIEWPORT_MARGIN = 24;
const SCREENSHOT_PREVIEW_CONTROL_RAIL = 46;
const SCREENSHOT_PREVIEW_CONTROL_HEIGHT = 83;

export function readScreenshotImageSize(src: string): Promise<ScreenshotSize> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      } else {
        reject(new Error("Screenshot has no image dimensions"));
      }
    };
    image.onerror = () => reject(new Error("Screenshot preview failed to decode"));
    image.src = src;
  });
}

/** Keeps the feedback beside the screen, bottom-aligned and out of its input path. */
export function resolveScreenshotPreviewSidecar({
  screen,
  capture,
  viewport,
  gap = SCREENSHOT_PREVIEW_GAP,
  margin = SCREENSHOT_PREVIEW_VIEWPORT_MARGIN,
}: {
  screen: Rect;
  capture: ScreenshotSize;
  viewport: ScreenshotSize;
  gap?: number;
  margin?: number;
}): ScreenshotPreviewLayout | null {
  if (
    !Number.isFinite(screen.height) ||
    screen.height <= 0 ||
    !Number.isFinite(capture.width) ||
    !Number.isFinite(capture.height) ||
    capture.width <= 0 ||
    capture.height <= 0
  ) {
    return null;
  }

  const desiredHeight = screen.height / 3;
  const desiredWidth = desiredHeight * (capture.width / capture.height);
  const screenRight = screen.left + screen.width;
  const screenBottom = screen.top + screen.height;
  const rightWidth =
    viewport.width -
    margin -
    screenRight -
    gap -
    SCREENSHOT_PREVIEW_CONTROL_RAIL;
  const leftWidth =
    screen.left - margin - gap - SCREENSHOT_PREVIEW_CONTROL_RAIL;
  const side: ScreenshotPreviewSide =
    rightWidth >= desiredWidth || rightWidth >= leftWidth ? "right" : "left";
  const availableWidth = Math.max(0, side === "right" ? rightWidth : leftWidth);
  if (
    screenBottom > viewport.height - margin ||
    screenBottom < margin + SCREENSHOT_PREVIEW_CONTROL_HEIGHT
  ) {
    return null;
  }
  const availableHeight = screenBottom - margin;
  const scale = Math.min(
    1,
    availableHeight / desiredHeight,
    availableWidth / desiredWidth,
  );
  const height = desiredHeight * scale;
  const width = desiredWidth * scale;
  if (!Number.isFinite(scale) || scale <= 0 || height <= 0 || width <= 0) {
    return null;
  }
  const left = side === "right"
    ? screenRight + gap
    : screen.left - gap - width;
  return { side, left, top: screenBottom - height, width, height };
}

export async function copyScreenshotBlob<Item = ClipboardItem>(
  blob: Blob,
  clipboard: { write(items: Item[]): Promise<void> } = navigator.clipboard as {
    write(items: Item[]): Promise<void>;
  },
  createItem: (data: Record<string, Blob>) => Item = (data) =>
    new ClipboardItem(data) as Item,
): Promise<void> {
  await clipboard.write([createItem({ "image/png": blob })]);
}

export async function normalizeScreenshotPng(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Unable to prepare screenshot");
    context.drawImage(bitmap, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("Unable to encode screenshot")),
        "image/png",
      );
    });
    return png;
  } finally {
    bitmap.close();
  }
}

export function ScreenshotFlash({
  deviceId,
  flash,
  borderRadius,
}: {
  deviceId: string;
  flash: ScreenshotFlashState | null;
  borderRadius?: CSSProperties["borderRadius"];
}) {
  if (!flash) return null;
  return (
    <div
      key={flash.id}
      aria-hidden="true"
      data-agentsims-screenshot-flash={deviceId}
      data-phase={flash.phase}
      className="agentsims-screenshot-flash pointer-events-none absolute inset-0 z-30 bg-white"
      style={{ borderRadius }}
    />
  );
}

export function DeviceScreenshotPreview({
  deviceId,
  preview,
  layout,
  onCopy,
  onDismiss,
}: {
  deviceId: string;
  preview: ScreenshotPreview | null;
  layout: ScreenshotPreviewLayout | null;
  onCopy: () => void;
  onDismiss: () => void;
}) {
  if (!preview || !layout) return null;
  return (
    <div
      data-agentsims-screenshot-preview={deviceId}
      data-side={layout.side}
      data-phase={preview.phase}
      className="agentsims-screenshot-preview pointer-events-none absolute z-40"
      style={{
        left: layout.left,
        top: layout.top,
        width: layout.width,
        height: layout.height,
      }}
    >
      <div className="agentsims-screenshot-preview-image size-full overflow-hidden rounded-[10px] bg-black">
        <img
          key={preview.id}
          src={preview.src}
          alt=""
          draggable={false}
          className="block size-full select-none"
          style={{
            objectFit: "contain",
            pointerEvents: "none",
          }}
        />
      </div>
      <div
        className="agentsims-screenshot-preview-controls pointer-events-auto absolute bottom-0 flex flex-col items-center"
        data-side={layout.side}
      >
        <button
          type="button"
          aria-label="Copy image"
          title="Copy image"
          disabled={preview.copying}
          onClick={onCopy}
        >
          <Copy aria-hidden="true" size={12} strokeWidth={2} />
        </button>
        <button
          type="button"
          aria-label="Discard screenshot"
          title="Discard screenshot"
          onClick={onDismiss}
        >
          <X aria-hidden="true" size={13} strokeWidth={2} />
        </button>
      </div>
      {preview.error ? (
        <div className="agentsims-screenshot-preview-error pointer-events-none absolute inset-x-1.5 bottom-1.5" role="alert">
          {preview.error}
        </div>
      ) : null}
    </div>
  );
}
