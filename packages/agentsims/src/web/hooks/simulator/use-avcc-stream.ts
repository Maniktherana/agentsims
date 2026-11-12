import { useEffect, useRef } from "react";
import { isAvccSupported } from "../../simulator/stream/avcc-codec.js";
import type { SimulatorFrameTiming } from "../../simulator/stream/avcc-codec.js";
import {
	AvccPlayer,
	type AvccPlayerEvent,
	type AvccPlayerSource,
} from "../../simulator/stream/avcc-player.js";
import type {
	AvccWorkerReply,
	AvccWorkerRequest,
} from "../../simulator/stream/avcc-worker-protocol.js";
import type {
	CanvasDisplay,
	Size,
} from "../../simulator/stream/canvas-backing-size.js";
import {
	publishStreamStats,
	streamStatsKey,
} from "../../simulator/stream/stream-stats.js";

export interface UseAvccStreamOptions {
	/** Base server URL, e.g. "http://localhost:3100". */
	url: string;
	/** When false, the hook tears down any active decode and does nothing. */
	enabled: boolean;
	/** This tab's viewer ID. The server streams only to the holder of the device. */
	viewer?: string | null;
	/** Target canvas the decoded frames are painted into. */
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
	/** Called the first time any frame (seed or decoded) is painted. */
	onFirstFrame?: () => void;
	/**
	 * Called when the painted size or presentation generation changes, and at
	 * most four times a second while frames are painted.
	 */
	onFrame?: (size: {
		width: number;
		height: number;
		presentationGeneration?: number;
	}) => void;
	/** Native timing when available; otherwise received video-frame timing. */
	onSimulatorFrameTiming?: (timing: SimulatorFrameTiming) => void;
	/** Tracks the HTTP stream transport independently from frame cadence. */
	onTransportChange?: (connected: boolean) => void;
	onStatusChange?: (status: string) => void;
	/** Called with a human-readable message when the decode pipeline fails. */
	onError?: (message: string) => void;
	/**
	 * Called when the WebCodecs decoder fails fatally (a `configure()` throw or
	 * repeated decoder errors), as opposed to a network hiccup. When provided it
	 * replaces {@link onError} for these failures: the consumer downgrades to
	 * MJPEG because hardware H.264 decode is no longer viable.
	 */
	onDecoderError?: () => void;
}

/** One player per canvas. A transferred canvas cannot be transferred again. */
interface StreamHost {
	start(source: AvccPlayerSource): void;
	stop(): void;
	resize(display: CanvasDisplay): void;
	capture(): Promise<ImageBitmap | null>;
	listen(listener: (event: AvccPlayerEvent) => void): () => void;
	dispose(): void;
}

const hosts = new WeakMap<HTMLCanvasElement, StreamHost>();

function workerHost(canvas: HTMLCanvasElement): StreamHost {
	const offscreen = canvas.transferControlToOffscreen();
	const worker = new Worker(
		new URL("../../simulator/stream/avcc-worker.ts", import.meta.url),
		{ type: "module", name: "agentsims-video" },
	);
	const post = (message: AvccWorkerRequest, transfer: Transferable[] = []) =>
		worker.postMessage(message, transfer);
	post({ type: "init", canvas: offscreen }, [offscreen]);
	const listeners = new Set<(event: AvccPlayerEvent) => void>();
	const captures = new Map<number, (bitmap: ImageBitmap | null) => void>();
	let nextCapture = 0;
	worker.onmessage = ({ data }: MessageEvent<AvccWorkerReply>) => {
		if (data.type === "capture") {
			const resolve = captures.get(data.id);
			captures.delete(data.id);
			if (resolve) resolve(data.bitmap);
			else data.bitmap?.close();
			return;
		}
		for (const listener of listeners) listener(data);
	};
	return {
		start: (source) => post({ type: "start", source }),
		stop: () => post({ type: "stop" }),
		resize: (display) => post({ type: "resize", display }),
		capture: () =>
			new Promise((resolve) => {
				const id = ++nextCapture;
				captures.set(id, resolve);
				post({ type: "capture", id });
			}),
		listen: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => {
			for (const resolve of captures.values()) resolve(null);
			captures.clear();
			worker.terminate();
		},
	};
}

/** Fallback for browsers that cannot transfer a canvas to a worker. */
function pageHost(canvas: HTMLCanvasElement): StreamHost {
	const listeners = new Set<(event: AvccPlayerEvent) => void>();
	const player = new AvccPlayer(canvas, (event) => {
		for (const listener of listeners) listener(event);
	});
	return {
		start: (source) => player.start(source),
		stop: () => player.stop(),
		resize: (display) => player.resize(display),
		capture: () => player.capture(),
		listen: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose: () => player.dispose(),
	};
}

function hostFor(canvas: HTMLCanvasElement): StreamHost {
	let host = hosts.get(canvas);
	if (!host) {
		host =
			typeof Worker !== "undefined" &&
			typeof canvas.transferControlToOffscreen === "function"
				? workerHost(canvas)
				: pageHost(canvas);
		hosts.set(canvas, host);
	}
	return host;
}

/** Follow an ancestor scale, such as an entry animation, until it settles. */
const SCALE_SETTLE_MS = 1_000;

function displayKey(display: CanvasDisplay): string {
	const box = display.devicePixelBox;
	return [
		display.layout.width,
		display.layout.height,
		display.rect.width,
		display.rect.height,
		display.devicePixelRatio,
		box?.width,
		box?.height,
	].join(",");
}

/**
 * Report how `canvas` is displayed: layout size, transformed size, device
 * pixel ratio, and device-pixel box. The player sizes the backing store from
 * this report and redraws the last frame in the same step.
 *
 * A box change and a ratio change come from the observer and a media query.
 * An ancestor scale does not change the box, so after each report the size is
 * followed for a short time while the transformed size moves or is not 1:1.
 */
function observeDisplay(
	canvas: HTMLCanvasElement,
	onDisplay: (display: CanvasDisplay) => void,
): () => void {
	let layout: Size | null = null;
	let devicePixelBox: Size | undefined;
	let last = "";
	let unitScale = true;
	let frame = 0;
	let settleUntil = 0;
	const measure = () => {
		const width = layout?.width ?? canvas.clientWidth;
		const height = layout?.height ?? canvas.clientHeight;
		if (!(width > 0 && height > 0)) return;
		const rect = canvas.getBoundingClientRect();
		const display: CanvasDisplay = {
			layout: { width, height },
			rect: { width: rect.width, height: rect.height },
			devicePixelRatio: globalThis.devicePixelRatio || 1,
			...(devicePixelBox ? { devicePixelBox } : {}),
		};
		unitScale =
			Math.abs(rect.width * rect.height - width * height) <=
			1e-3 * width * height;
		const key = displayKey(display);
		if (key === last) return;
		last = key;
		onDisplay(display);
	};
	const follow = () => {
		frame = 0;
		const before = last;
		measure();
		if ((last !== before || !unitScale) && performance.now() < settleUntil)
			frame = requestAnimationFrame(follow);
	};
	const update = () => {
		measure();
		if (typeof requestAnimationFrame === "undefined") return;
		settleUntil = performance.now() + SCALE_SETTLE_MS;
		if (!frame) frame = requestAnimationFrame(follow);
	};
	// The observer does not run while the page is hidden. Measure once now.
	update();

	// A browser zoom or a move to another display changes the ratio.
	let ratioQuery: MediaQueryList | null = null;
	const watchRatio = () => {
		ratioQuery?.removeEventListener("change", onRatio);
		if (typeof matchMedia !== "function") return;
		ratioQuery = matchMedia(
			`(resolution: ${globalThis.devicePixelRatio || 1}dppx)`,
		);
		ratioQuery.addEventListener("change", onRatio);
	};
	function onRatio() {
		watchRatio();
		update();
	}
	watchRatio();

	let observer: ResizeObserver | null = null;
	if (typeof ResizeObserver !== "undefined") {
		observer = new ResizeObserver(([entry]) => {
			if (!entry) return;
			layout = {
				width: entry.contentRect.width,
				height: entry.contentRect.height,
			};
			const box = entry.devicePixelContentBoxSize?.[0];
			devicePixelBox = box
				? { width: box.inlineSize, height: box.blockSize }
				: undefined;
			update();
		});
		try {
			observer.observe(canvas, { box: "device-pixel-content-box" });
		} catch {
			observer.observe(canvas);
		}
	}
	return () => {
		observer?.disconnect();
		ratioQuery?.removeEventListener("change", onRatio);
		if (frame) cancelAnimationFrame(frame);
	};
}

type CaptureRegistry = Record<string, () => Promise<ImageBitmap | null>>;

/**
 * Decode an H.264 `/stream.avcc` feed into `canvasRef` via WebCodecs.
 *
 * Read, decode, and paint run in a worker that owns the canvas. The page gets
 * only coarse events. The callbacks are read through a ref so fresh closures
 * do not restart the stream. A no-op when AVCC is unsupported, `enabled` is
 * false, or `url` is empty.
 */
export type AvccStreamHandle = {
	/**
	 * The newest frame shown on a still screen, at decoded size. The page cannot
	 * read pixels from a canvas that a worker owns.
	 */
	presentedImage(): ImageBitmap | null;
};

export function useAvccStream({
	url,
	enabled,
	viewer,
	canvasRef,
	onFirstFrame,
	onFrame,
	onSimulatorFrameTiming,
	onTransportChange,
	onStatusChange,
	onError,
	onDecoderError,
}: UseAvccStreamOptions): AvccStreamHandle {
	// Latest-callback ref: keeps the decode effect off the callback identities.
	const callbacks = useRef({
		onFirstFrame,
		onFrame,
		onSimulatorFrameTiming,
		onTransportChange,
		onStatusChange,
		onError,
		onDecoderError,
	});
	callbacks.current = {
		onFirstFrame,
		onFrame,
		onSimulatorFrameTiming,
		onTransportChange,
		onStatusChange,
		onError,
		onDecoderError,
	};

	const stillRef = useRef<ImageBitmap | null>(null);
	const handleRef = useRef<AvccStreamHandle>({
		presentedImage: () => stillRef.current,
	});

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!enabled || !url || !canvas || !isAvccSupported()) return;
		const host = hostFor(canvas);
		const statsKey = streamStatsKey(url);
		let transportConnected = false;
		const unlisten = host.listen((event) => {
			const current = callbacks.current;
			switch (event.type) {
				case "transport":
					if (transportConnected === event.connected) return;
					transportConnected = event.connected;
					current.onTransportChange?.(event.connected);
					return;
				case "status":
					current.onStatusChange?.(event.status);
					return;
				case "first-frame":
					current.onFirstFrame?.();
					return;
				case "frame":
					current.onFrame?.({
						width: event.width,
						height: event.height,
						...(event.presentationGeneration === undefined
							? {}
							: { presentationGeneration: event.presentationGeneration }),
					});
					return;
				case "timing":
					current.onSimulatorFrameTiming?.({
						sequence: event.sequence,
						timestampUs: event.timestampUs,
					});
					return;
				case "error":
					current.onError?.(event.message);
					return;
				case "decoder-error":
					if (current.onDecoderError) current.onDecoderError();
					else current.onError?.("H.264 decoding failed");
					return;
				case "stats":
					publishStreamStats(statsKey, event.stats);
					return;
				case "still":
					stillRef.current?.close();
					stillRef.current = event.bitmap;
					return;
			}
		});
		const stopObserving = observeDisplay(canvas, (display) =>
			host.resize(display),
		);
		const registry = ((globalThis as Record<string, unknown>)
			.__agentsimsStreamCapture ??= {}) as CaptureRegistry;
		const capture = () => host.capture();
		registry[statsKey] = capture;
		host.start({ url, viewer });

		return () => {
			host.stop();
			unlisten();
			stopObserving();
			if (registry[statsKey] === capture) delete registry[statsKey];
			if (transportConnected) callbacks.current.onTransportChange?.(false);
			stillRef.current?.close();
			stillRef.current = null;
			// The canvas stays mounted across a new source. Release the worker
			// only after React removes the canvas.
			setTimeout(() => {
				if (canvas.isConnected || hosts.get(canvas) !== host) return;
				hosts.delete(canvas);
				host.dispose();
			}, 0);
		};
	}, [url, enabled, viewer, canvasRef]);

	return handleRef.current;
}
