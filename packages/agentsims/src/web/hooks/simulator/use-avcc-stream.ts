import { useEffect, useRef } from "react";
import {
  AvccDemuxer,
  avcCodecString,
  isAvccSupported,
  parseAndroidFramePresentation,
  parseSimulatorFrameTiming,
  type SimulatorFrameTiming,
  type AvccChunkType,
} from "../../simulator/stream/avcc-codec.js";

export interface UseAvccStreamOptions {
  /** Base server URL, e.g. "http://localhost:3100". */
  url: string;
  /** When false, the hook tears down any active decode and does nothing. */
  enabled: boolean;
  /** Target canvas the decoded frames are painted into. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Called the first time any frame (seed or decoded) is painted. */
  onFirstFrame?: () => void;
  /** Called on every painted frame for presentation state and staleness checks. */
  onFrame?: (size: { width: number; height: number; presentationGeneration?: number }) => void;
  /** Native simulator framebuffer timing carried in the AVCC stream. */
  onSimulatorFrameTiming?: (timing: SimulatorFrameTiming) => void;
  /** Tracks the HTTP stream transport independently from frame cadence. */
  onTransportChange?: (connected: boolean) => void;
  /** Called with a human-readable message when the decode pipeline fails. */
  onError?: (message: string) => void;
  /**
   * Called when the WebCodecs decoder itself fails fatally (a `VideoDecoder`
   * `error` event or a `configure()` throw) — as opposed to a network/stream
   * hiccup. When provided it *replaces* {@link onError} for these failures: the
   * consumer is expected to downgrade to MJPEG (hardware H.264 decode is no
   * longer viable — e.g. a screen recorder starving VideoToolbox), so the
   * failure is recovered from rather than surfaced as a user-facing error.
   */
  onDecoderError?: () => void;
}

const RETRY_DELAY_MS = 1000;
/** ~60fps monotonic tick. Never displayed — WebCodecs just needs increasing PTS. */
const FRAME_DURATION_US = 16_667;

/**
 * Decode an H.264 `/stream.avcc` feed into `canvasRef` via WebCodecs.
 *
 * The decode pipeline is keyed only on `url` and `enabled`; the callbacks are
 * read through a ref so passing fresh closures every render does not restart the
 * stream. A no-op when AVCC is unsupported, `enabled` is false, or `url` is
 * empty (a device-less preview config would otherwise fetch a relative
 * `undefined/stream.avcc` from the page origin).
 */
export function useAvccStream({
  url,
  enabled,
  canvasRef,
  onFirstFrame,
  onFrame,
  onSimulatorFrameTiming,
  onTransportChange,
  onError,
  onDecoderError,
}: UseAvccStreamOptions): void {
  // Latest-callback ref: keeps the decode effect off the callback identities.
  const callbacks = useRef({
    onFirstFrame,
    onFrame,
    onSimulatorFrameTiming,
    onTransportChange,
    onError,
    onDecoderError,
  });
  callbacks.current = {
    onFirstFrame,
    onFrame,
    onSimulatorFrameTiming,
    onTransportChange,
    onError,
    onDecoderError,
  };

  useEffect(() => {
    if (!enabled || !url || !isAvccSupported()) return;

    const controller = new AbortController();
    const demuxer = new AvccDemuxer();
    let stopped = false;
    let painted = false;
    let timestamp = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let decoder: VideoDecoder | null = null;
    let pendingFrame: { frame: VideoFrame; generation?: number } | null = null;
    const decodeGenerations: Array<number | undefined> = [];
    let frameGeneration: number | undefined;
    let decoderGeneration: number | undefined;
    let paintFrameRequest = 0;
    let transportConnected = false;

    const isLive = () => !stopped && !controller.signal.aborted;
    const setTransportConnected = (connected: boolean) => {
      if (transportConnected === connected) return;
      transportConnected = connected;
      callbacks.current.onTransportChange?.(connected);
    };

    // A fatal decode failure routes to onDecoderError (downgrade to MJPEG) when
    // a handler is wired, else surfaces as a user-facing error. Routing to both
    // would flash a red overlay over the stream the parent is about to recover.
    const reportDecodeFailure = (message: string) => {
      if (callbacks.current.onDecoderError) callbacks.current.onDecoderError();
      else callbacks.current.onError?.(message);
    };

    const paint = (
      source: CanvasImageSource,
      width: number,
      height: number,
      generation?: number,
    ) => {
      if (!isLive()) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(source, 0, 0, width, height);
      callbacks.current.onFrame?.({
        width,
        height,
        ...(generation === undefined ? {} : { presentationGeneration: generation }),
      });
      if (!painted) {
        painted = true;
        callbacks.current.onFirstFrame?.();
      }
    };

    const queuePaint = (frame: VideoFrame) => {
      const generation = decodeGenerations.shift();
      if (!isLive()) {
        frame.close();
        return;
      }
      pendingFrame?.frame.close();
      pendingFrame = { frame, generation };
      if (paintFrameRequest) return;
      paintFrameRequest = requestAnimationFrame(() => {
        paintFrameRequest = 0;
        const latest = pendingFrame;
        pendingFrame = null;
        if (!latest) return;
        try {
          if (isLive()) {
            paint(
              latest.frame,
              latest.frame.displayWidth,
              latest.frame.displayHeight,
              latest.generation,
            );
          }
        } finally {
          latest.frame.close();
        }
      });
    };

    const makeDecoder = () =>
      new VideoDecoder({
        output: queuePaint,
        error: (err) => reportDecodeFailure(`decoder: ${err.message}`),
      });

    const paintSeed = async (jpeg: Uint8Array) => {
      // JPEG seed — paint immediately for an instant first frame.
      const bitmap = await createImageBitmap(new Blob([jpeg as BlobPart], { type: "image/jpeg" }));
      try {
        if (isLive()) paint(bitmap, bitmap.width, bitmap.height, frameGeneration);
      } finally {
        bitmap.close();
      }
    };

    const configureDecoder = (description: Uint8Array) => {
      if (decoder && decoderGeneration !== frameGeneration) {
        decoder.close();
        decoder = null;
        decodeGenerations.length = 0;
      }
      if (!decoder || decoder.state === "closed") decoder = makeDecoder();
      decoderGeneration = frameGeneration;
      try {
        decoder.configure({
          codec: avcCodecString(description),
          description,
          // `optimizeFor` is a valid runtime hint not yet in lib.dom's types.
          optimizeFor: "latency",
          hardwareAcceleration: "prefer-hardware",
        } as VideoDecoderConfig & { optimizeFor: "latency" });
      } catch (err) {
        reportDecodeFailure(`config: ${(err as Error).message}`);
      }
    };

    const decodeFrame = (type: "keyframe" | "delta", data: Uint8Array) => {
      if (decoder?.state !== "configured") return;
      try {
        decodeGenerations.push(frameGeneration);
        decoder.decode(
          new EncodedVideoChunk({
            type: type === "keyframe" ? "key" : "delta",
            timestamp,
            data,
          }),
        );
        timestamp += FRAME_DURATION_US;
      } catch {
        /* drop undecodable frame */
      }
    };

    const handleChunk = (type: AvccChunkType, payload: Uint8Array) => {
      switch (type) {
        case "seed":
          void paintSeed(payload).catch(() => {});
          return;
        case "description":
          configureDecoder(payload);
          return;
        case "presentation": {
          const metadata = parseAndroidFramePresentation(payload);
          if (!metadata) return;
          frameGeneration = metadata.generation;
          if (decoderGeneration !== frameGeneration) {
            decoder?.close();
            decoder = null;
            decodeGenerations.length = 0;
          }
          return;
        }
        case "simulator-frame-timing": {
          const timing = parseSimulatorFrameTiming(payload);
          if (timing) callbacks.current.onSimulatorFrameTiming?.(timing);
          return;
        }
        case "keyframe":
        case "delta":
          decodeFrame(type, payload);
          return;
      }
    };

    const scheduleRetry = () => {
      if (!isLive() || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void read();
      }, RETRY_DELAY_MS);
    };

    const read = async () => {
      // Each HTTP response is a self-contained stream that opens with its own
      // description — drop any partial bytes left over from a dropped connection.
      demuxer.reset();
      try {
        const res = await fetch(`${url}/stream.avcc`, {
          signal: controller.signal,
        });
        const reader = res.body?.getReader();
        if (!reader) return;
        setTransportConnected(true);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          for (const chunk of demuxer.push(value)) {
            handleChunk(chunk.type, chunk.payload);
          }
        }
      } catch {
        /* aborted or network error — falls through to retry */
      } finally {
        if (isLive()) {
          setTransportConnected(false);
          scheduleRetry();
        }
      }
    };

    void read();

    return () => {
      stopped = true;
      setTransportConnected(false);
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
      demuxer.reset();
      if (paintFrameRequest) cancelAnimationFrame(paintFrameRequest);
      paintFrameRequest = 0;
      pendingFrame?.frame.close();
      pendingFrame = null;
      if (decoder && decoder.state !== "closed") {
        try {
          decoder.close();
        } catch {
          /* already closed */
        }
      }
      decoder = null;
    };
  }, [url, enabled, canvasRef]);
}
