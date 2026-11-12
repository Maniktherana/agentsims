import type { AvccPlayerEvent, AvccPlayerSource } from "./avcc-player.js";
import type { CanvasDisplay } from "./canvas-backing-size.js";

/** Messages from the page to the video worker. */
export type AvccWorkerRequest =
	| { type: "init"; canvas: OffscreenCanvas }
	| { type: "start"; source: AvccPlayerSource }
	| { type: "stop" }
	| { type: "resize"; display: CanvasDisplay }
	| { type: "capture"; id: number };

/** Messages from the video worker to the page. */
export type AvccWorkerReply =
	| AvccPlayerEvent
	| { type: "capture"; id: number; bitmap: ImageBitmap | null };
