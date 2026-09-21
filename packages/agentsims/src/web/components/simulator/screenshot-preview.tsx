import { Button } from "@agentsims/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@agentsims/ui/components/tooltip";
import { Copy, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
	DEVICE_PRESENCE_HIDDEN_SCALE,
	DEVICE_PRESENCE_TRANSITION,
} from "../../simulator/presence-motion";

export type ScreenshotPreviewSide = "right" | "left";

export type ScreenshotPreview = {
	id: string;
	src: string;
	width: number;
	height: number;
	phase: "enter" | "visible" | "exit";
	copying: boolean;
	error: string | null;
	source?: ScreenshotPreviewSource;
};

export type ScreenshotFlashState = {
	id: string;
	phase: "solid" | "fading";
	source?: ScreenshotPreviewSource;
};

export type ScreenshotPreviewSource = {
	left: number;
	top: number;
	width: number;
	height: number;
	borderRadius?: CSSProperties["borderRadius"];
	cornerShape?: string;
};

export type ScreenshotPreviewLayout = {
	side: ScreenshotPreviewSide;
	left: number;
	top: number;
	width: number;
	height: number;
	sourceLeft: number;
	sourceTop: number;
	sourceWidth: number;
	sourceHeight: number;
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
const SCREENSHOT_PREVIEW_CONTROL_HEIGHT = 83;

/** Maps the final thumbnail box back onto the screen captured at click time. */
export function screenshotPreviewSourceTransform(
	layout: ScreenshotPreviewLayout,
	source?: ScreenshotPreviewSource,
) {
	return {
		x: (source?.left ?? layout.sourceLeft) - layout.left,
		y: (source?.top ?? layout.sourceTop) - layout.top,
		scaleX: (source?.width ?? layout.sourceWidth) / layout.width,
		scaleY: (source?.height ?? layout.sourceHeight) / layout.height,
	};
}

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
		image.onerror = () =>
			reject(new Error("Screenshot preview failed to decode"));
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
	const anchorBottom = Math.min(
		screen.top + screen.height,
		viewport.height - margin,
	);
	const rightWidth = viewport.width - margin - screenRight - gap;
	const leftWidth = screen.left - margin - gap;
	const side: ScreenshotPreviewSide =
		rightWidth >= desiredWidth || rightWidth >= leftWidth ? "right" : "left";
	const availableWidth = Math.max(0, side === "right" ? rightWidth : leftWidth);
	if (anchorBottom < margin + SCREENSHOT_PREVIEW_CONTROL_HEIGHT) {
		return null;
	}
	const availableHeight = anchorBottom - margin;
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
	const left = side === "right" ? screenRight + gap : screen.left - gap - width;
	return {
		side,
		left,
		top: anchorBottom - height,
		width,
		height,
		sourceLeft: screen.left,
		sourceTop: screen.top,
		sourceWidth: screen.width,
		sourceHeight: screen.height,
	};
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
				(result) =>
					result
						? resolve(result)
						: reject(new Error("Unable to encode screenshot")),
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
	const content = (
		<ScreenshotFlashSurface
			key={flash.id}
			deviceId={deviceId}
			flash={flash}
			borderRadius={borderRadius}
		/>
	);
	return flash.source && typeof document !== "undefined"
		? createPortal(content, document.body)
		: content;
}

function ScreenshotFlashSurface({
	deviceId,
	flash,
	borderRadius,
}: {
	deviceId: string;
	flash: ScreenshotFlashState;
	borderRadius?: CSSProperties["borderRadius"];
}) {
	const reducedMotion = useReducedMotion();
	const source = flash.source;
	return (
		<motion.div
			aria-hidden="true"
			data-agentsims-screenshot-flash={deviceId}
			data-phase={flash.phase}
			className="agentsims-screenshot-flash pointer-events-none bg-white"
			initial={false}
			animate={{ opacity: reducedMotion || flash.phase === "fading" ? 0 : 1 }}
			transition={{
				duration: reducedMotion || flash.phase === "solid" ? 0 : 0.21,
			}}
			style={
				{
					position: source ? "fixed" : "absolute",
					inset: source ? undefined : 0,
					left: source?.left,
					top: source?.top,
					width: source?.width,
					height: source?.height,
					zIndex: source ? 2147483647 : 30,
					borderRadius: source?.borderRadius ?? borderRadius,
					cornerShape: source?.cornerShape,
				} as CSSProperties
			}
		/>
	);
}

export function ScreenshotPreviewOverlay({
	deviceId,
	preview,
	layout,
	borderRadius,
	onCopy,
	onDismiss,
	onReady,
	onExitComplete,
	onInteractionChange,
}: {
	deviceId: string;
	preview: ScreenshotPreview | null;
	layout: ScreenshotPreviewLayout | null;
	borderRadius?: CSSProperties["borderRadius"];
	onCopy: () => void;
	onDismiss: () => void;
	onReady?: () => void;
	onExitComplete?: () => void;
	onInteractionChange?: (interacting: boolean) => void;
}) {
	if (!preview || !layout) return null;
	const content = (
		<ScreenshotPreviewSurface
			key={preview.id}
			deviceId={deviceId}
			preview={preview}
			layout={layout}
			borderRadius={borderRadius}
			onCopy={onCopy}
			onDismiss={onDismiss}
			onReady={onReady}
			onExitComplete={onExitComplete}
			onInteractionChange={onInteractionChange}
		/>
	);
	return typeof document === "undefined"
		? content
		: createPortal(content, document.body);
}

function ScreenshotPreviewSurface({
	deviceId,
	preview,
	layout,
	borderRadius,
	onCopy,
	onDismiss,
	onReady,
	onExitComplete,
	onInteractionChange,
}: {
	deviceId: string;
	preview: ScreenshotPreview;
	layout: ScreenshotPreviewLayout;
	borderRadius?: CSSProperties["borderRadius"];
	onCopy: () => void;
	onDismiss: () => void;
	onReady?: () => void;
	onExitComplete?: () => void;
	onInteractionChange?: (interacting: boolean) => void;
}) {
	const reducedMotion = useReducedMotion();
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const controlsVisible = preview.phase === "visible" && (hovered || focused);
	const exiting = preview.phase === "exit";
	useEffect(() => {
		onInteractionChange?.(hovered || focused);
	}, [hovered, focused, onInteractionChange]);
	useEffect(() => {
		if (reducedMotion && preview.phase === "enter") onReady?.();
	}, [onReady, preview.phase, reducedMotion]);
	const clipStyle = {
		borderRadius: preview.source?.borderRadius ?? borderRadius,
		cornerShape: preview.source?.cornerShape,
	} as CSSProperties;
	return (
		<motion.div
			data-agentsims-screenshot-preview={deviceId}
			data-side={layout.side}
			data-phase={preview.phase}
			className="agentsims-screenshot-preview fixed z-[2147483646]"
			initial={
				reducedMotion || preview.phase !== "enter"
					? false
					: {
							...screenshotPreviewSourceTransform(layout, preview.source),
							opacity: 1,
						}
			}
			animate={{
				x: 0,
				y: 0,
				scaleX: exiting && !reducedMotion ? DEVICE_PRESENCE_HIDDEN_SCALE : 1,
				scaleY: exiting && !reducedMotion ? DEVICE_PRESENCE_HIDDEN_SCALE : 1,
				opacity: exiting ? 0 : 1,
			}}
			transition={
				reducedMotion
					? { duration: 0 }
					: {
							...DEVICE_PRESENCE_TRANSITION,
							duration: exiting ? DEVICE_PRESENCE_TRANSITION.duration : 0.3,
							delay: preview.phase === "enter" ? 0.25 : 0,
						}
			}
			onAnimationComplete={() => {
				if (exiting) onExitComplete?.();
				else if (preview.phase === "enter") onReady?.();
			}}
			onPointerEnter={() => setHovered(true)}
			onPointerLeave={() => setHovered(false)}
			onFocusCapture={() => setFocused(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null))
					setFocused(false);
			}}
			style={{
				left: layout.left,
				top: layout.top,
				width: layout.width,
				height: layout.height,
				transformOrigin: exiting ? "center center" : "top left",
				pointerEvents: preview.phase === "visible" ? undefined : "none",
				...clipStyle,
			}}
		>
			<div
				className="agentsims-screenshot-preview-image size-full overflow-hidden bg-black"
				style={clipStyle}
			>
				<motion.img
					key={preview.id}
					src={preview.src}
					alt=""
					draggable={false}
					className="block size-full select-none"
					initial={false}
					animate={{
						filter: controlsVisible
							? "blur(2px) brightness(0.65)"
							: "blur(0px) brightness(1)",
					}}
					transition={{ duration: reducedMotion ? 0 : 0.12 }}
					style={{ objectFit: "contain", pointerEvents: "none" }}
				/>
			</div>
			<motion.div
				className="agentsims-screenshot-preview-controls absolute right-1.5 top-1.5 flex items-center"
				initial={false}
				animate={{ opacity: controlsVisible ? 1 : 0 }}
				transition={{ duration: reducedMotion ? 0 : 0.12 }}
				style={{ pointerEvents: controlsVisible ? "auto" : "none" }}
			>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Copy image"
								size="icon-sm"
								variant="toolbar"
								style={{ borderRadius: 9999 }}
								className="bg-[#f2f2f2]! text-[#181818]! hover:bg-white!"
								disabled={preview.copying}
								onClick={onCopy}
							/>
						}
					>
						<Copy aria-hidden="true" size={14} strokeWidth={2} />
					</TooltipTrigger>
					<TooltipContent>Copy image</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								aria-label="Close screenshot"
								size="icon-sm"
								variant="toolbar"
								style={{ borderRadius: 9999 }}
								className="bg-[#f2f2f2]! text-[#181818]! hover:bg-white!"
								onClick={onDismiss}
							/>
						}
					>
						<X aria-hidden="true" size={14} strokeWidth={2} />
					</TooltipTrigger>
					<TooltipContent>Close</TooltipContent>
				</Tooltip>
			</motion.div>
		</motion.div>
	);
}
