import type { CapturedScreenshotPreview } from "../../hooks/simulator/use-screenshot-preview";

export type ScreenshotCaptureFlow = {
	requestId: number;
	done: Promise<void>;
};

export function startScreenshotCapture({
	capturePresentedSurface,
	begin,
	captureAuthoritative,
	replace,
	reportError,
}: {
	capturePresentedSurface: () => CapturedScreenshotPreview | null;
	begin: (capture: CapturedScreenshotPreview) => number;
	captureAuthoritative: () => Promise<CapturedScreenshotPreview>;
	replace: (
		requestId: number,
		capture: CapturedScreenshotPreview,
	) => boolean | void;
	reportError: (message: string) => void;
}): ScreenshotCaptureFlow | null {
	let optimistic: CapturedScreenshotPreview | null;
	try {
		optimistic = capturePresentedSurface();
	} catch (error) {
		reportError(
			error instanceof Error
				? error.message
				: "Unable to capture rendered screen",
		);
		return null;
	}
	if (!optimistic) {
		reportError("The simulator has not presented a frame yet");
		return null;
	}

	const requestId = begin(optimistic);
	let authoritative: Promise<CapturedScreenshotPreview>;
	try {
		authoritative = captureAuthoritative();
	} catch (error) {
		reportError(error instanceof Error ? error.message : "Screenshot failed");
		return { requestId, done: Promise.resolve() };
	}
	const done = authoritative.then(
		(capture) => {
			replace(requestId, capture);
		},
		(error: unknown) => {
			if ((error as { name?: string }).name !== "AbortError") {
				reportError(
					error instanceof Error ? error.message : "Screenshot failed",
				);
			}
		},
	);
	return { requestId, done };
}

/**
 * A screenshot from the server only. The preview opens when the full-size
 * image arrives. The page never reads pixels from the stream surface.
 */
export function startServerScreenshotCapture({
	begin,
	captureAuthoritative,
	reportError,
}: {
	begin: (capture: CapturedScreenshotPreview) => number;
	captureAuthoritative: () => Promise<CapturedScreenshotPreview>;
	reportError: (message: string) => void;
}): ScreenshotCaptureFlow {
	const done = captureAuthoritative().then(
		(capture) => {
			begin(capture);
		},
		(error: unknown) => {
			if ((error as { name?: string }).name !== "AbortError")
				reportError(
					error instanceof Error ? error.message : "Screenshot failed",
				);
		},
	);
	return { requestId: 0, done };
}
