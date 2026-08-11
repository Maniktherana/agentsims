import { useCallback, useEffect, useRef, useState } from "react";
import {
  copyScreenshotBlob,
  type ScreenshotFlashState,
  type ScreenshotPreview,
} from "../components/device-screenshot-feedback";

export type CapturedScreenshotPreview = {
  id: string;
  src: string;
  width: number;
  height: number;
  blob: Blob;
  save: (signal: AbortSignal) => void | Promise<void>;
  cancel?: () => void;
  release?: () => void;
};

const FLASH_HOLD_MS = 45;
const FLASH_FADE_MS = 145;
export const PREVIEW_READY_COUNTDOWN_MS = 5000;
export const PREVIEW_EXIT_MS = 160;

export class ScreenshotCaptureSession {
  private latestRequest = 0;

  begin(): number {
    this.latestRequest += 1;
    return this.latestRequest;
  }

  accept(requestId: number, capture: CapturedScreenshotPreview): CapturedScreenshotPreview | null {
    if (requestId === this.latestRequest) return capture;
    capture.release?.();
    return null;
  }

  invalidate(): void {
    this.latestRequest += 1;
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.latestRequest;
  }
}

export class ScreenshotPreviewCountdown {
  private timer: ReturnType<typeof setTimeout> | null = null;

  ready(save: () => void | Promise<void>, delay = PREVIEW_READY_COUNTDOWN_MS): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      void save();
    }, delay);
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

function screenshotAbortError(): Error {
  const error = new Error("Screenshot save aborted");
  error.name = "AbortError";
  return error;
}

export class ScreenshotSaveCoordinator {
  private active: { id: string; controller: AbortController } | null = null;

  async run(id: string, save: (signal: AbortSignal) => void | Promise<void>): Promise<void> {
    this.cancel();
    const controller = new AbortController();
    this.active = { id, controller };
    try {
      await save(controller.signal);
      if (controller.signal.aborted) throw screenshotAbortError();
    } finally {
      if (this.active?.controller === controller) this.active = null;
    }
  }

  cancel(id?: string): boolean {
    if (!this.active || (id !== undefined && this.active.id !== id)) return false;
    this.active.controller.abort();
    this.active = null;
    return true;
  }
}

type ActiveScreenshotPreview = ScreenshotPreview & {
  blob: Blob;
  save: (signal: AbortSignal) => void | Promise<void>;
  cancel?: () => void;
  release?: () => void;
};

export function replaceScreenshotCapture(
  current: ActiveScreenshotPreview,
  replacement: CapturedScreenshotPreview,
): ActiveScreenshotPreview {
  return {
    ...current,
    src: replacement.src,
    blob: replacement.blob,
    save: replacement.save,
    cancel: replacement.cancel,
    release: replacement.release,
  };
}

type ScreenshotPreviewCompletionEntry = Pick<ActiveScreenshotPreview, "id" | "save" | "cancel">;

export async function completeScreenshotPreview({
  id,
  getActive,
  saveCoordinator,
  hasVisualPlacement,
  onExit,
  onRemove,
  onError,
}: {
  id: string;
  getActive: () => ScreenshotPreviewCompletionEntry | null;
  saveCoordinator: ScreenshotSaveCoordinator;
  hasVisualPlacement: () => boolean;
  onExit: (id: string) => void;
  onRemove: (id: string) => void;
  onError: (id: string, message: string) => void;
}): Promise<void> {
  const latest = getActive();
  if (!latest || latest.id !== id) return;
  latest.cancel?.();
  try {
    await saveCoordinator.run(id, latest.save);
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return;
    if (!hasVisualPlacement()) {
      onRemove(id);
      return;
    }
    onError(id, error instanceof Error ? error.message : "Unable to save screenshot");
    return;
  }
  if (getActive()?.id !== id) return;
  if (hasVisualPlacement()) onExit(id);
  else onRemove(id);
}

export function useDeviceScreenshotFeedback() {
  const [flash, setFlash] = useState<ScreenshotFlashState | null>(null);
  const [preview, setPreview] = useState<ActiveScreenshotPreview | null>(null);
  const sessionRef = useRef<ScreenshotCaptureSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new ScreenshotCaptureSession();
  const countdownRef = useRef<ScreenshotPreviewCountdown | null>(null);
  if (!countdownRef.current) countdownRef.current = new ScreenshotPreviewCountdown();
  const activePreviewIdRef = useRef<string | null>(null);
  const activeRequestIdRef = useRef<number | null>(null);
  const activePreviewRef = useRef<ActiveScreenshotPreview | null>(null);
  const readyPreviewIdRef = useRef<string | null>(null);
  const visuallyPlacedPreviewIdRef = useRef<string | null>(null);
  const saveCoordinatorRef = useRef<ScreenshotSaveCoordinator | null>(null);
  if (!saveCoordinatorRef.current) {
    saveCoordinatorRef.current = new ScreenshotSaveCoordinator();
  }
  const flashFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashRemoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewRemoveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearFlashTimers = useCallback(() => {
    if (flashFadeTimerRef.current) clearTimeout(flashFadeTimerRef.current);
    if (flashRemoveTimerRef.current) clearTimeout(flashRemoveTimerRef.current);
    flashFadeTimerRef.current = null;
    flashRemoveTimerRef.current = null;
  }, []);

  const clearPreviewTimers = useCallback(() => {
    countdownRef.current?.cancel();
    if (previewRemoveTimerRef.current) clearTimeout(previewRemoveTimerRef.current);
    previewRemoveTimerRef.current = null;
  }, []);

  const cancelActiveWork = useCallback(() => {
    countdownRef.current?.cancel();
    activePreviewRef.current?.cancel?.();
    saveCoordinatorRef.current?.cancel();
  }, []);

  const releaseActivePreview = useCallback((id?: string) => {
    const active = activePreviewRef.current;
    if (!active || (id && active.id !== id)) return;
    active.release?.();
    activePreviewRef.current = null;
    activePreviewIdRef.current = null;
    activeRequestIdRef.current = null;
    readyPreviewIdRef.current = null;
    visuallyPlacedPreviewIdRef.current = null;
  }, []);

  const removePreview = useCallback(
    (id: string) => {
      setPreview((current) => (current?.id === id ? null : current));
      releaseActivePreview(id);
    },
    [releaseActivePreview],
  );

  const exitPreview = useCallback(
    (id: string) => {
      cancelActiveWork();
      sessionRef.current?.invalidate();
      activeRequestIdRef.current = null;
      readyPreviewIdRef.current = null;
      setPreview((current) => (current?.id === id ? { ...current, phase: "exit" } : current));
      if (previewRemoveTimerRef.current) clearTimeout(previewRemoveTimerRef.current);
      previewRemoveTimerRef.current = setTimeout(() => removePreview(id), PREVIEW_EXIT_MS);
    },
    [cancelActiveWork, removePreview],
  );

  const beginCapture = useCallback(
    (capture: CapturedScreenshotPreview): number => {
      cancelActiveWork();
      clearPreviewTimers();
      releaseActivePreview();
      const requestId = sessionRef.current!.begin();
      const id = capture.id;
      clearFlashTimers();
      const next: ActiveScreenshotPreview = {
        ...capture,
        phase: "enter",
        copying: false,
        error: null,
      };
      activePreviewRef.current = next;
      activePreviewIdRef.current = id;
      activeRequestIdRef.current = requestId;
      readyPreviewIdRef.current = null;
      visuallyPlacedPreviewIdRef.current = null;
      setPreview(next);
      setFlash({ id: `screenshot-flash-${requestId}`, phase: "solid" });
      flashFadeTimerRef.current = setTimeout(() => {
        setFlash((current) =>
          current?.id === `screenshot-flash-${requestId}`
            ? { ...current, phase: "fading" }
            : current,
        );
      }, FLASH_HOLD_MS);
      flashRemoveTimerRef.current = setTimeout(() => {
        setFlash((current) => (current?.id === `screenshot-flash-${requestId}` ? null : current));
      }, FLASH_HOLD_MS + FLASH_FADE_MS);
      return requestId;
    },
    [cancelActiveWork, clearFlashTimers, clearPreviewTimers, releaseActivePreview],
  );

  const replaceCapture = useCallback(
    (requestId: number, capture: CapturedScreenshotPreview): boolean => {
      const current = activePreviewRef.current;
      if (
        !current ||
        activeRequestIdRef.current !== requestId ||
        !sessionRef.current!.isCurrent(requestId)
      ) {
        capture.release?.();
        return false;
      }
      current.release?.();
      const next = replaceScreenshotCapture(current, capture);
      activePreviewRef.current = next;
      setPreview(next);
      return true;
    },
    [],
  );

  const markPreviewReady = useCallback(
    (id: string, hasVisualPlacement = true) => {
      const current = activePreviewRef.current;
      if (!current || current.id !== id) return;
      visuallyPlacedPreviewIdRef.current = hasVisualPlacement ? id : null;
      if (readyPreviewIdRef.current === id) return;
      readyPreviewIdRef.current = id;
      const visible = { ...current, phase: "visible" as const };
      activePreviewRef.current = visible;
      setPreview(visible);
      countdownRef.current?.ready(() =>
        completeScreenshotPreview({
          id,
          getActive: () => activePreviewRef.current,
          saveCoordinator: saveCoordinatorRef.current!,
          hasVisualPlacement: () => visuallyPlacedPreviewIdRef.current === id,
          onExit: exitPreview,
          onRemove: removePreview,
          onError: (erroredId, message) => {
            setPreview((value) => {
              if (value?.id !== erroredId) return value;
              const errored = { ...value, error: message };
              activePreviewRef.current = errored;
              return errored;
            });
          },
        }),
      );
    },
    [exitPreview, removePreview],
  );

  const dismissPreview = useCallback(() => {
    const id = preview?.id;
    if (!id) return;
    exitPreview(id);
  }, [exitPreview, preview?.id]);

  const copyPreview = useCallback(async () => {
    const current = preview;
    if (!current || current.copying) return;
    cancelActiveWork();
    sessionRef.current?.invalidate();
    activeRequestIdRef.current = null;
    setPreview((value) =>
      value?.id === current.id ? { ...value, copying: true, error: null } : value,
    );
    try {
      await copyScreenshotBlob(activePreviewRef.current?.blob ?? current.blob);
      exitPreview(current.id);
    } catch (error) {
      setPreview((value) =>
        value?.id === current.id
          ? {
              ...value,
              copying: false,
              error: error instanceof Error ? error.message : "Unable to copy screenshot",
            }
          : value,
      );
    }
  }, [cancelActiveWork, exitPreview, preview]);

  const reset = useCallback(() => {
    sessionRef.current?.invalidate();
    clearFlashTimers();
    clearPreviewTimers();
    cancelActiveWork();
    releaseActivePreview();
    setFlash(null);
    setPreview(null);
  }, [cancelActiveWork, clearFlashTimers, clearPreviewTimers, releaseActivePreview]);

  useEffect(
    () => () => {
      sessionRef.current?.invalidate();
      clearFlashTimers();
      clearPreviewTimers();
      cancelActiveWork();
      releaseActivePreview();
    },
    [cancelActiveWork, clearFlashTimers, clearPreviewTimers, releaseActivePreview],
  );

  return {
    flash,
    preview,
    beginCapture,
    replaceCapture,
    markPreviewReady,
    copyPreview,
    dismissPreview,
    reset,
  };
}
