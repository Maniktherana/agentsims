import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  SimulatorView,
  digitalCrownDeltaFromWheel,
  screenBorderRadius,
  SimulatorToolbar,
  ROTATE_LEFT_CYCLE,
  ROTATE_RIGHT_CYCLE,
  type SimulatorOrientation,
  type StreamConfig,
} from "../simulator";

import { ArrowLeft, GripVertical, ListTree, Menu, Upload } from "lucide-react";
import { ReloadIcon } from "../icons";
import {
  ConnectedReviewLaunchers,
  ReviewDeviceController,
} from "../../annotations/web/review/review-device-controller";
import { AxStateProvider } from "../../annotations/web/state/ax-state-provider";
import type { ReviewEvent } from "../../annotations/web/state/review-reducer";
import { selectNeedsAxSnapshot } from "../../annotations/web/state/review-selectors";
import type { ReviewState } from "../../annotations/web/state/review-state";
import { AnnotationSurface } from "../../annotations/web/overlay/annotation-surface";
import { DeviceKitChrome, type ChromeButtonPress } from "../components/device-chrome-frame";
import {
  DeviceScreenshotPreview,
  ScreenshotFlash,
  normalizeScreenshotPng,
  readScreenshotImageSize,
  resolveScreenshotPreviewSidecar,
  type ScreenshotPreviewLayout,
} from "../components/device-screenshot-feedback";
import { ResizeHandle } from "../components/resize-handle";
import { SimulatorResizeCornerHandle } from "../components/simulator-resize-corner-handle";
import { SimulatorResizeSizeBadge } from "../components/simulator-resize-size-badge";
import { StreamStatusPill } from "../components/stream-status-pill";
import { ToolsPanel } from "../components/tools-panel";
import {
  CODEC_PREFERENCE_STORAGE_KEY,
  type CodecPreference,
} from "../components/stream-settings-tool";
import { WebKitDevtoolsPanel } from "../components/webkit-devtools-panel";
import { useMediaDrop } from "../hooks/use-media-drop";
import { useDeviceScreenshotFeedback } from "../hooks/use-device-screenshot-feedback";
import { useMjpegStream } from "../hooks/use-mjpeg-stream";
import { useAvccStream } from "../hooks/use-avcc-stream";
import { useResizableWidth } from "../hooks/use-resizable-width";
import { useScreenshotToast } from "../hooks/use-screenshot-toast";
import { useSimulatorResize } from "../hooks/use-simulator-resize";
import { useUploadToasts } from "../hooks/use-upload-toasts";
import { useWebKitDevtools } from "../hooks/use-webkit-devtools";
import type { DeviceKitChromeDescriptor } from "../utils/grid";
import { avccFallbackReducer, initialAvccFallback, AVCC_FRAME_TIMEOUT_MS } from "../avcc-fallback";
import { fileExtension } from "../utils/drop";
import { execOnHost, openHostEventStream } from "../utils/exec";
import { hidUsageForCode } from "../utils/hid";
import { DEVTOOLS_PANEL_WIDTH, PANEL_WIDTH } from "../utils/panel-widths";
import { simEndpoint } from "../utils/sim-endpoint";
import type { RenderedScreenshot } from "../utils/rendered-screenshot";
import { startScreenshotCapture } from "../utils/screenshot-capture-flow";
import { saveScreenshotToHost } from "../utils/screenshot-save";
import { PresentedFrameRateStore } from "../utils/presented-frame-rate";
import {
  SIMULATOR_RESIZE_DRAG_TRANSITION,
  SIMULATOR_RESIZE_LAYOUT_TRANSITION,
  SIMULATOR_RESIZE_PAGE_TRANSITION,
} from "../utils/simulator-resize";
import {
  EMBEDDED_WORKSPACE_VERTICAL_RESERVE,
  resolveSimulatorDeviceLayout,
} from "../utils/simulator-device-layout";
import { WORKSPACE_DEVICE_GEOMETRY_EVENT } from "../layout-events";
import {
  flushWsMessageQueue,
  sendOrQueueWsMessage,
  type QueuedWsMessage,
} from "../utils/ws-send-queue";
import type { PreviewConfig } from "./workspace-state";
import { createAxRefreshScheduler } from "./ax-refresh-scheduler";

type CurrentApp = { bundleId: string; isReactNative: boolean; pid?: number };
const currentAppCache = new Map<string, CurrentApp>();

export interface SimulatorDeviceViewProps {
  config: PreviewConfig;
  deviceName: string | null;
  deviceRuntime: string | null;
  chrome: DeviceKitChromeDescriptor | null;
  preferMjpeg: boolean;
  reviewState: ReviewState;
  dispatchReview: (event: ReviewEvent) => void;
  toolsOpen: boolean;
  setToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  devtoolsOpen: boolean;
  setDevtoolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedDevtoolsTargetId: string | null;
  setSelectedDevtoolsTargetId: React.Dispatch<React.SetStateAction<string | null>>;
  streaming: boolean;
  setStreaming: (v: boolean) => void;
  embedded?: boolean;
  focused?: boolean;
  settingsPosition?: -1 | 0 | 1;
  onFocus?: () => void;
}

export function SimulatorDeviceView({
  config,
  deviceName,
  deviceRuntime,
  chrome,
  preferMjpeg,
  reviewState,
  dispatchReview,
  toolsOpen,
  setToolsOpen,
  devtoolsOpen,
  setDevtoolsOpen,
  selectedDevtoolsTargetId,
  setSelectedDevtoolsTargetId,
  streaming,
  setStreaming,
  embedded = false,
  focused = true,
  settingsPosition = 0,
  onFocus,
}: SimulatorDeviceViewProps) {
  const panelsEnabled = !embedded || focused;
  const annotationActive = reviewState.kind === "annotate";
  const accessibilityOpen = reviewState.kind === "accessibility";
  const accessibilitySelecting = accessibilityOpen && reviewState.picking;
  const accessibilityShowAll = accessibilityOpen && reviewState.showAllNodes;
  const needsAxSnapshot = selectNeedsAxSnapshot(reviewState);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const setStreamingRef = useRef(setStreaming);
  setStreamingRef.current = setStreaming;
  const presentedFrameRate = useMemo(() => new PresentedFrameRateStore(), [config.device]);

  useEffect(() => {
    if (!focused) return;
    document.title = deviceName ? `Simulator - ${deviceName}` : "Simulator Preview";
  }, [deviceName, focused]);

  const isAndroidDevice = config.device.startsWith("android:");
  const [axRefreshSignal, requestAxRefresh] = useReducer((value: number) => value + 1, 0);
  const [axRefreshScheduler] = useState(() => createAxRefreshScheduler(requestAxRefresh));
  const scheduleAxRefresh = useCallback(() => {
    if (!isAndroidDevice || !needsAxSnapshot) return;
    axRefreshScheduler.schedule();
  }, [axRefreshScheduler, isAndroidDevice, needsAxSnapshot]);
  useEffect(() => {
    if (!isAndroidDevice || !needsAxSnapshot) axRefreshScheduler.cancel();
  }, [axRefreshScheduler, isAndroidDevice, needsAxSnapshot]);
  useEffect(() => () => axRefreshScheduler.cancel(), [axRefreshScheduler]);
  const devtools = useWebKitDevtools(
    config.devtoolsEndpoint ?? simEndpoint("devtools"),
    panelsEnabled && !isAndroidDevice && devtoolsOpen,
  );
  const webkitDevtoolsOpen = !isAndroidDevice && devtoolsOpen;

  useEffect(() => {
    if (!panelsEnabled || !webkitDevtoolsOpen) return;
    if (
      selectedDevtoolsTargetId &&
      devtools.targets.some((target) => target.id === selectedDevtoolsTargetId)
    )
      return;
    setSelectedDevtoolsTargetId(devtools.targets.length === 1 ? devtools.targets[0]!.id : null);
  }, [
    panelsEnabled,
    webkitDevtoolsOpen,
    devtools.targets,
    selectedDevtoolsTargetId,
    setSelectedDevtoolsTargetId,
  ]);

  useEffect(() => {
    if (!focused) return;
    setSelectedDevtoolsTargetId(null);
  }, [config.device, focused, setSelectedDevtoolsTargetId]);

  // Prefer H.264 (AVCC via WebCodecs) when the browser supports it; otherwise
  // fall back to MJPEG. The MJPEG reader stays dormant (null url) under AVCC so
  // we never pull both streams at once. The AVCC frames are decoded view-side
  // by SimulatorView's `useAvccStream`; this hook just reports browser support.
  //
  // Browser support is necessary but not sufficient: the helper may not serve
  // `/stream.avcc` at all. A device started from the UI is spawned via
  // `bunx agentsims --detach`, which runs the published `agentsims` — older
  // versions predate H.264 and 404 the endpoint (cross-origin that 404 is
  // opaque to fetch, so "no frame arrived" is the only reliable signal).
  // `avccFallback` drives a startup timeout: if AVCC paints nothing in time,
  // drop to MJPEG, which every helper serves. See avcc-fallback.ts.
  const avcc = useAvccStream();
  const [avccFallback, dispatchAvccFallback] = useReducer(avccFallbackReducer, initialAvccFallback);
  // `?codec=mjpeg` forces the JPEG fallback path even where WebCodecs exists —
  // an escape hatch for browsers whose H.264 decode misbehaves, and the way to
  // exercise the MJPEG pipeline in a browser that would otherwise pick AVCC.
  const [forceMjpeg] = useState(
    () => new URLSearchParams(window.location.search).get("codec") === "mjpeg",
  );
  // User-selectable codec preference (Video section of the tools panel). "mjpeg"
  // forces the software path; the H.264 hardware decoder shares the GPU's
  // VideoToolbox pipeline with screen recorders, so MJPEG is the fix when the
  // stream stutters/drops while recording the browser window. Persisted so the
  // choice survives reloads.
  const [codecPreference, setCodecPreference] = useState<CodecPreference>(() =>
    window.localStorage.getItem(CODEC_PREFERENCE_STORAGE_KEY) === "mjpeg" ? "mjpeg" : "auto",
  );
  useEffect(() => {
    window.localStorage.setItem(CODEC_PREFERENCE_STORAGE_KEY, codecPreference);
  }, [codecPreference]);
  // The server can pin the stream codec (`agentsims --codec mjpeg`) for hosts
  // whose hardware can't encode H.264 — e.g. VMs lacking the high/low-latency
  // H.264 profiles. Treat that as a hard override the viewer can't switch off.
  const serverForcesMjpeg = config.codec === "mjpeg";
  const useAvccVideo = isAndroidDevice
    ? avcc.supported && !serverForcesMjpeg
    : !serverForcesMjpeg &&
      avcc.supported &&
      !avccFallback.fellBack &&
      !preferMjpeg &&
      !forceMjpeg &&
      codecPreference !== "mjpeg";
  const videoCodec = isAndroidDevice ? "avcc" : useAvccVideo ? "avcc" : "mjpeg";
  const mjpeg = useMjpegStream(useAvccVideo || isAndroidDevice ? null : config.streamUrl);

  // Re-arm AVCC whenever the target stream changes (device switch / reconnect).
  useEffect(() => {
    setStreamingRef.current(false);
    dispatchAvccFallback("reset");
  }, [config.streamUrl]);
  // `streaming` flips true on the first painted AVCC frame (JPEG seed decodes
  // sub-second on a healthy helper), which cancels the fallback.
  useEffect(() => {
    if (isAndroidDevice) return;
    if (useAvccVideo && streaming) dispatchAvccFallback("frame");
  }, [isAndroidDevice, useAvccVideo, streaming]);
  // One-shot startup window; on expiry fall back unless a frame already landed.
  useEffect(() => {
    if (isAndroidDevice) return;
    if (!useAvccVideo) return;
    const timer = setTimeout(() => dispatchAvccFallback("timeout"), AVCC_FRAME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isAndroidDevice, useAvccVideo, config.streamUrl]);
  const [liveStreamConfig, setLiveStreamConfig] = useState<StreamConfig | null>(null);
  // Screen config now arrives over the input WebSocket (pushed by the helper on
  // connect + on every dimension/orientation change) instead of a 1s /config poll.
  const [wsStreamConfig, setWsStreamConfig] = useState<StreamConfig | null>(null);
  const streamConfig = wsStreamConfig;
  const initialDeviceLayout = resolveSimulatorDeviceLayout({
    deviceName,
    chrome,
  });
  const activeStreamConfig = liveStreamConfig ?? streamConfig ?? initialDeviceLayout.streamConfig;
  const deviceLayout = resolveSimulatorDeviceLayout({
    deviceName,
    chrome,
    streamConfig: activeStreamConfig,
  });
  const {
    deviceType,
    useChrome,
    defaultWidth: containerDefaultWidth,
    aspectRatio: containerAspectRatio,
    aspectRatioValue: containerAspectRatioValue,
  } = deviceLayout;
  const imgBorderRadius = screenBorderRadius(deviceType, activeStreamConfig);

  // Touch/button relay via direct WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const pendingWsMessagesRef = useRef<QueuedWsMessage[]>([]);
  useEffect(() => {
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let currentWs: WebSocket | null = null;
    pendingWsMessagesRef.current = [];

    const scheduleReconnect = () => {
      if (stopped || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1000);
    };

    const connect = () => {
      const ws = new WebSocket(config.wsUrl);
      ws.binaryType = "arraybuffer";
      currentWs = ws;
      wsRef.current = ws;
      ws.onopen = () => {
        pendingWsMessagesRef.current = flushWsMessageQueue(ws, pendingWsMessagesRef.current);
      };
      ws.onmessage = (ev) => {
        // Server -> client screen-config push (tag 0x82): [tag][JSON].
        if (!(ev.data instanceof ArrayBuffer)) return;
        const bytes = new Uint8Array(ev.data);
        if (bytes.length < 1 || bytes[0] !== 0x82) return;
        try {
          const cfg = JSON.parse(new TextDecoder().decode(bytes.subarray(1))) as StreamConfig;
          if (cfg.width <= 0 || cfg.height <= 0) return;
          setWsStreamConfig((prev) =>
            prev &&
            prev.width === cfg.width &&
            prev.height === cfg.height &&
            prev.orientation === cfg.orientation
              ? prev
              : cfg,
          );
        } catch {}
      };
      ws.onclose = () => {
        if (wsRef.current === ws) wsRef.current = null;
        scheduleReconnect();
      };
      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (wsRef.current === currentWs) wsRef.current = null;
      currentWs?.close();
    };
  }, [config.wsUrl]);

  const sendWs = useCallback((tag: number, payload: object) => {
    pendingWsMessagesRef.current = sendOrQueueWsMessage(
      wsRef.current,
      pendingWsMessagesRef.current,
      tag,
      payload,
    );
  }, []);

  const onStreamTouch = useCallback(
    (data: any) => {
      sendWs(0x03, data);
      if (data?.type === "end") scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );
  const onStreamMultiTouch = useCallback(
    (data: any) => {
      sendWs(0x05, data);
      if (data?.type === "end") scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );
  const onStreamButton = useCallback(
    (button: string) => {
      sendWs(0x04, { button });
      scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );
  // A hardware button on the device chrome was pressed/released. Forward its HID
  // (page, usage) so the helper injects it via arbitrary HID — `down`/`up` phases
  // let power / side buttons be held for their long-press menus.
  const handleChromeButton = useCallback(
    ({ phase, button }: ChromeButtonPress) => {
      if (button.usagePage == null || button.usage == null) return;
      sendWs(0x04, {
        button: button.name,
        page: button.usagePage,
        usage: button.usage,
        phase,
      });
      if (phase === "up") scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );
  const onStreamDigitalCrown = useCallback((delta: number) => sendWs(0x0a, { delta }), [sendWs]);
  const onStreamScroll = useCallback(
    (data: { dx: number; dy: number; x: number; y: number }) => {
      sendWs(0x0b, data);
    },
    [sendWs],
  );
  const onScreenConfigChange = useCallback((next: StreamConfig) => {
    setLiveStreamConfig((prev) =>
      prev &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.orientation === next.orientation
        ? prev
        : next,
    );
  }, []);
  const rotateDevice = useCallback(
    (orientation: SimulatorOrientation) => {
      sendWs(0x07, { orientation });
      scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );
  const currentOrientation =
    (activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? "portrait";
  const canRotate = deviceType !== "watch" && deviceType !== "vision";
  const rotateBy = useCallback(
    (direction: "left" | "right") => {
      if (!canRotate) return;
      const next = (direction === "left" ? ROTATE_LEFT_CYCLE : ROTATE_RIGHT_CYCLE)[
        currentOrientation
      ];
      rotateDevice(next);
    },
    [canRotate, currentOrientation, rotateDevice],
  );

  useEffect(() => {
    setLiveStreamConfig(null);
    setWsStreamConfig(null);
  }, [config.streamUrl]);

  useEffect(() => {
    const confirmedConfig = streamConfig;
    if (!confirmedConfig) return;
    setLiveStreamConfig((prev) =>
      prev &&
      prev.width === confirmedConfig.width &&
      prev.height === confirmedConfig.height &&
      prev.orientation === confirmedConfig.orientation
        ? prev
        : null,
    );
  }, [streamConfig, streamConfig?.width, streamConfig?.height, streamConfig?.orientation]);

  const sendKey = useCallback(
    (type: "down" | "up", usage: number) => {
      sendWs(0x06, { type, usage });
      if (type === "up") scheduleAxRefresh();
    },
    [scheduleAxRefresh, sendWs],
  );

  // Subscribe to app-state SSE.
  const [currentApp, setCurrentApp] = useState<CurrentApp | null>(
    () => currentAppCache.get(config.device) ?? null,
  );
  const { width: toolsPanelWidth, onPointerDown: onToolsResize } = useResizableWidth(
    "agentsims:tools-panel-width",
    PANEL_WIDTH,
    240,
    720,
  );
  const { width: devtoolsPanelWidth, onPointerDown: onDevtoolsResize } = useResizableWidth(
    "agentsims:devtools-panel-width",
    DEVTOOLS_PANEL_WIDTH,
    420,
    1400,
  );
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 0,
  );
  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const es = openHostEventStream(config.appStateEndpoint ?? simEndpoint("appstate"));
    let timer: ReturnType<typeof setTimeout> | null = null;
    es.onmessage = (e) => {
      try {
        const next = JSON.parse(e.data) as CurrentApp;
        if (timer) clearTimeout(timer);
        const delay = next?.isReactNative ? 0 : 600;
        timer = setTimeout(() => {
          currentAppCache.set(config.device, next);
          setCurrentApp(next);
        }, delay);
      } catch {}
    };
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [config.appStateEndpoint, config.device]);

  // Cmd+R to reload the RN/Expo bundle.
  const sendReactNativeReload = useCallback(async () => {
    if (isAndroidDevice) {
      sendWs(0x0d, { action: "reload_react_native" });
      return;
    }
    const META = 0xe3;
    const R = 0x15;
    sendKey("down", META);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("down", R);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("up", R);
    await new Promise((r) => setTimeout(r, 30));
    sendKey("up", META);
  }, [isAndroidDevice, sendKey, sendWs]);

  const simContainerRef = useRef<HTMLDivElement | null>(null);
  const deviceStackRef = useRef<HTMLDivElement | null>(null);
  const screenSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [deviceRenderedWidth, setDeviceRenderedWidth] = useState(0);
  const [deviceRenderedHeight, setDeviceRenderedHeight] = useState(0);
  useEffect(() => {
    const el = simContainerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      setDeviceRenderedWidth(rect?.width ?? 0);
      setDeviceRenderedHeight(rect?.height ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [simFocused, setSimFocused] = useState(true);
  const simFocusedRef = useRef(true);
  simFocusedRef.current = simFocused;
  const pressedKeysRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const inside = !!simContainerRef.current?.contains(e.target as Node);
      if (inside) {
        onFocus?.();
        setSimFocused(true);
      } else if (focusedRef.current) {
        setSimFocused(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onFocus]);

  useEffect(() => {
    if (simFocused && focused) return;
    const held = pressedKeysRef.current;
    if (held.size === 0) return;
    for (const usage of held) sendWs(0x06, { type: "up", usage });
    held.clear();
  }, [simFocused, focused, sendWs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent, type: "down" | "up") => {
      if (e.defaultPrevented) return;
      const target = e.target;
      if (
        target instanceof Element &&
        (target.matches("input, textarea, select") || target.closest("[contenteditable='true']"))
      ) {
        return;
      }
      if (!focusedRef.current || !simFocusedRef.current) return;
      if (e.code === "KeyH" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) sendWs(0x04, { button: "home" });
        return;
      }
      if (
        (e.code === "ArrowLeft" || e.code === "ArrowRight") &&
        e.metaKey &&
        !e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey
      ) {
        e.preventDefault();
        if (type === "down" && !e.repeat) {
          rotateBy(e.code === "ArrowLeft" ? "left" : "right");
        }
        return;
      }
      if (e.code === "KeyA" && e.metaKey && e.shiftKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) {
          if (isAndroidDevice) {
            sendWs(0x0d, { action: "toggle_appearance" });
          } else {
            execOnHost(`xcrun simctl ui ${config.device} appearance`)
              .then((r) => {
                const next = r.stdout.trim() === "dark" ? "light" : "dark";
                return execOnHost(`xcrun simctl ui ${config.device} appearance ${next}`);
              })
              .catch(() => {});
          }
        }
        return;
      }
      if (e.code === "KeyK" && e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();
        if (type === "down" && !e.repeat) sendWs(0x0c, {});
        return;
      }
      const usage = hidUsageForCode(e.code);
      if (usage == null) return;
      e.preventDefault();
      if (type === "down") pressedKeysRef.current.add(usage);
      else pressedKeysRef.current.delete(usage);
      sendWs(0x06, { type, usage });
    };
    const down = (e: KeyboardEvent) => onKey(e, "down");
    const up = (e: KeyboardEvent) => onKey(e, "up");
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [sendWs, config.device, rotateBy, isAndroidDevice]);

  const uploads = useUploadToasts();
  const screenshot = useScreenshotToast(config.device);
  const screenshotFeedback = useDeviceScreenshotFeedback();
  const [screenshotPreviewLayout, setScreenshotPreviewLayout] =
    useState<ScreenshotPreviewLayout | null>(null);
  const screenshotRequestRef = useRef<AbortController | null>(null);
  const capturePresentedSurfaceRef = useRef<(() => RenderedScreenshot | null) | null>(null);
  const onCapturePresentedSurfaceChange = useCallback(
    (capture: (() => RenderedScreenshot | null) | null) => {
      capturePresentedSurfaceRef.current = capture;
    },
    [],
  );

  const saveCapturedScreenshot = useCallback(
    async (blob: Blob, signal: AbortSignal) => {
      const path = await saveScreenshotToHost(blob, config.device, signal);
      screenshot.reportSaved(path);
    },
    [config.device, screenshot],
  );

  const captureDeviceScreenshot = useCallback(
    async (controller: AbortController) => {
      const screenshotUrl = new URL("screenshot.png", config.streamUrl).toString();
      const res = await fetch(screenshotUrl, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Screenshot failed (${res.status})`);
      const blob = await normalizeScreenshotPng(await res.blob());
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      const href = URL.createObjectURL(blob);
      try {
        const size = await readScreenshotImageSize(href);
        return {
          id: crypto.randomUUID(),
          src: href,
          ...size,
          blob,
          save: (signal: AbortSignal) => saveCapturedScreenshot(blob, signal),
          release: () => URL.revokeObjectURL(href),
        };
      } catch (error) {
        URL.revokeObjectURL(href);
        throw error;
      } finally {
        if (screenshotRequestRef.current === controller) {
          screenshotRequestRef.current = null;
        }
      }
    },
    [config.streamUrl, saveCapturedScreenshot],
  );

  const resetScreenshotFeedback = screenshotFeedback.reset;
  useEffect(
    () => () => {
      screenshotRequestRef.current?.abort();
      screenshotRequestRef.current = null;
      capturePresentedSurfaceRef.current = null;
      resetScreenshotFeedback();
    },
    [config.device, resetScreenshotFeedback],
  );

  const captureScreenshot = useCallback(() => {
    screenshotRequestRef.current?.abort();
    const controller = new AbortController();
    screenshotRequestRef.current = controller;
    const flow = startScreenshotCapture({
      capturePresentedSurface: () => {
        const rendered = capturePresentedSurfaceRef.current?.() ?? null;
        if (!rendered) return null;
        return {
          id: crypto.randomUUID(),
          ...rendered,
          save: (signal: AbortSignal) => saveCapturedScreenshot(rendered.blob, signal),
          cancel: () => controller.abort(),
        };
      },
      begin: screenshotFeedback.beginCapture,
      captureAuthoritative: () => captureDeviceScreenshot(controller),
      replace: screenshotFeedback.replaceCapture,
      reportError: screenshot.reportError,
    });
    if (!flow) {
      controller.abort();
      if (screenshotRequestRef.current === controller) {
        screenshotRequestRef.current = null;
      }
      return;
    }
    void flow.done.finally(() => {
      if (screenshotRequestRef.current === controller) {
        screenshotRequestRef.current = null;
      }
    });
  }, [captureDeviceScreenshot, saveCapturedScreenshot, screenshot, screenshotFeedback]);

  useLayoutEffect(() => {
    const preview = screenshotFeedback.preview;
    const screen = screenSurfaceRef.current;
    const stack = deviceStackRef.current;
    if (!preview || !screen || !stack) {
      setScreenshotPreviewLayout(null);
      return;
    }

    let frame: number | null = null;
    const refresh = () => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => {
        frame = null;
        const screenRect = screen.getBoundingClientRect();
        const stackRect = stack.getBoundingClientRect();
        const placement = resolveScreenshotPreviewSidecar({
          screen: screenRect,
          capture: preview,
          viewport: { width: window.innerWidth, height: window.innerHeight },
        });
        const next = placement
          ? {
              ...placement,
              left: placement.left - stackRect.left,
              top: placement.top - stackRect.top,
            }
          : null;
        setScreenshotPreviewLayout((current) => {
          if (
            current?.side === next?.side &&
            current?.left === next?.left &&
            current?.top === next?.top &&
            current?.width === next?.width &&
            current?.height === next?.height
          ) {
            return current;
          }
          return next;
        });
      });
    };
    const onGeometry = (event: Event) => {
      const detail = (event as CustomEvent<{ deviceId?: string }>).detail;
      if (!detail?.deviceId || detail.deviceId === config.device) refresh();
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    resizeObserver?.observe(screen);
    resizeObserver?.observe(stack);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    window.addEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
    refresh();
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
    };
  }, [
    config.device,
    screenshotFeedback.preview?.height,
    screenshotFeedback.preview?.id,
    screenshotFeedback.preview?.width,
  ]);
  useEffect(() => {
    if (screenshotFeedback.preview) {
      screenshotFeedback.markPreviewReady(
        screenshotFeedback.preview.id,
        Boolean(screenshotPreviewLayout),
      );
    }
  }, [screenshotFeedback.markPreviewReady, screenshotFeedback.preview, screenshotPreviewLayout]);
  const mediaDrop = useMediaDrop({
    exec: execOnHost,
    udid: config.device,
    enabled: streaming,
    onUploadStart: uploads.add,
    onUploadProgress: uploads.setProgress,
    onUploadEnd: (id, ok, message) =>
      uploads.update(id, { status: ok ? "success" : "error", message }),
    onUnsupported: (file) => {
      const id = uploads.add(file.name, "media");
      uploads.update(id, {
        status: "error",
        message: `Unsupported: ${file.type || fileExtension(file)}`,
      });
    },
    onHostPathDrop: screenshot.dismiss,
  });

  const simulatorResize = useSimulatorResize({
    defaultWidth: containerDefaultWidth,
    viewportWidth,
    viewportHeight: embedded
      ? Math.max(320, viewportHeight - EMBEDDED_WORKSPACE_VERTICAL_RESERVE)
      : viewportHeight,
    aspectRatio: containerAspectRatioValue,
    onStart: () => setSimFocused(false),
  });

  const rightPanelWidthPx = webkitDevtoolsOpen
    ? devtoolsPanelWidth
    : toolsOpen
      ? toolsPanelWidth
      : 0;

  return (
    <AxStateProvider
      endpoint={config?.axEndpoint}
      refreshSignal={axRefreshSignal}
      reviewActive={needsAxSnapshot}
      reviewState={reviewState}
      dispatchReview={dispatchReview}
      annotationEndpoint={config.annotationEndpoint}
      deviceId={config.device}
    >
      <ReviewDeviceController
        reviewState={reviewState}
        dispatchReview={dispatchReview}
        focused={focused}
        anchor={simContainerRef.current}
        deviceId={config.device}
        deviceName={deviceName}
        deviceRuntime={deviceRuntime}
        currentApp={currentApp}
        connected={streaming}
        reservedRight={rightPanelWidthPx > 0 ? rightPanelWidthPx + 12 : 0}
      >
        <div
          className={`flex flex-col items-center justify-center gap-3 font-system box-border ${
            embedded ? "relative max-h-full min-h-0 bg-transparent py-3" : "h-screen bg-page py-6"
          }`}
          style={{
            paddingLeft: 24,
            paddingRight: 24,
            transition:
              simulatorResize.isResizing || simulatorResize.isInertia
                ? "none"
                : SIMULATOR_RESIZE_PAGE_TRANSITION,
          }}
          onPointerDownCapture={onFocus}
        >
          <div
            ref={deviceStackRef}
            className="relative flex flex-col items-center gap-3 min-w-0"
            style={{
              width: simulatorResize.width,
              transition:
                simulatorResize.isResizing || simulatorResize.isInertia
                  ? SIMULATOR_RESIZE_DRAG_TRANSITION
                  : SIMULATOR_RESIZE_LAYOUT_TRANSITION,
            }}
          >
            <SimulatorToolbar
              exec={execOnHost}
              onRotate={rotateDevice}
              orientation={
                (activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? null
              }
              deviceUdid={config.device}
              deviceName={deviceName}
              deviceRuntime={deviceRuntime}
              streaming={streaming}
              aria-label="Simulator status"
              data-agentsims-device-drag-handle
              style={{
                alignSelf: "center",
                width: "auto",
                minWidth: 0,
                maxWidth: "100%",
                flexWrap: "nowrap",
                justifyContent: "center",
                gap: 10,
                padding: "6px 10px",
                borderRadius: 10,
                border: "1px solid rgba(255, 255, 255, 0.09)",
                cursor: "grab",
                touchAction: "none",
                userSelect: "none",
              }}
            >
              <GripVertical
                aria-hidden="true"
                size={13}
                strokeWidth={1.8}
                className="shrink-0 text-white/32"
              />
              <span className="max-w-[min(230px,calc(100vw-170px))] truncate text-[12px] font-semibold text-white/92">
                {deviceName ?? "Simulator"}
              </span>
              <StreamStatusPill streaming={streaming} frameRate={presentedFrameRate} />
            </SimulatorToolbar>
            <div
              ref={simContainerRef}
              data-agentsims-device-frame={config.device}
              className="relative max-h-full"
              style={{
                width: simulatorResize.width,
                aspectRatio: containerAspectRatio,
                transition:
                  simulatorResize.isResizing || simulatorResize.isInertia
                    ? SIMULATOR_RESIZE_DRAG_TRANSITION
                    : SIMULATOR_RESIZE_LAYOUT_TRANSITION,
                willChange:
                  simulatorResize.isResizing || simulatorResize.isInertia ? "width" : undefined,
              }}
              {...mediaDrop.dropZoneProps}
            >
              {(() => {
                const streamView = (
                  <SimulatorView
                    url={config.url}
                    wsUrl={config.wsUrl}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "none",
                      pointerEvents:
                        simulatorResize.isResizing || simulatorResize.isInertia
                          ? "none"
                          : undefined,
                    }}
                    imageStyle={
                      {
                        // With chrome the screen slot clips (rounded) and the bezel
                        // provides the edge, so the stream itself is square + flush.
                        // Without chrome, round the screen and add a subtle bezel as an
                        // INSET shadow (not a border): a 1px border sits outside the
                        // content and, on the <canvas> path, composites its
                        // semi-transparent white against the black page as a visible
                        // outline. An inset shadow paints over the (opaque) video edge.
                        borderRadius: useChrome ? 0 : imgBorderRadius,
                        cornerShape: useChrome ? undefined : "superellipse(1.3)",
                        ...(useChrome
                          ? {}
                          : { boxShadow: "inset 0 0 0 1px rgba(255, 255, 255, 0.2)" }),
                      } as CSSProperties
                    }
                    hideControls
                    onStreamingChange={setStreaming}
                    frameRate={presentedFrameRate}
                    onStreamTouch={onStreamTouch}
                    onStreamMultiTouch={onStreamMultiTouch}
                    onStreamButton={onStreamButton}
                    onStreamDigitalCrown={onStreamDigitalCrown}
                    onStreamScroll={onStreamScroll}
                    codec={videoCodec}
                    onAvccError={isAndroidDevice ? undefined : () => dispatchAvccFallback("error")}
                    subscribeFrame={
                      useAvccVideo || isAndroidDevice ? undefined : mjpeg.subscribeFrame
                    }
                    streamFrame={useAvccVideo || isAndroidDevice ? undefined : mjpeg.frame}
                    streamConfig={activeStreamConfig}
                    enableDigitalCrown={deviceType === "watch"}
                    maxInputFps={isAndroidDevice ? 60 : undefined}
                    onScreenConfigChange={onScreenConfigChange}
                    onCapturePresentedSurfaceChange={onCapturePresentedSurfaceChange}
                  />
                );
                const screenContent = (
                  <>
                    {streamView}
                    <AnnotationSurface
                      active={annotationActive}
                      inspectorMode={
                        accessibilityOpen ? (accessibilitySelecting ? "select" : "passive") : null
                      }
                      inspectorShowAll={accessibilityShowAll}
                      onInspectorPick={(key) => {
                        dispatchReview({
                          type: "ACCESSIBILITY_TARGET_SELECTED",
                          key,
                          origin: "phone",
                        });
                        dispatchReview({
                          type: "ACCESSIBILITY_PICKING_CHANGED",
                          picking: false,
                        });
                      }}
                      screen={activeStreamConfig}
                    />
                    <div
                      ref={screenSurfaceRef}
                      data-agentsims-device-screen={config.device}
                      className="pointer-events-none absolute inset-0"
                    >
                      <ScreenshotFlash
                        deviceId={config.device}
                        flash={screenshotFeedback.flash}
                        borderRadius={useChrome ? undefined : imgBorderRadius}
                      />
                    </div>
                  </>
                );
                if (!useChrome) return screenContent;
                // The screen slot is the bezel's true opening; the stream letterboxes
                // (contains) inside it, filling the constraining axis and leaving a
                // thin black margin on the other — the device's own black screen
                // border. Containing (not covering) keeps the stream from ever
                // overflowing past the bezel.
                return (
                  <DeviceKitChrome
                    chrome={chrome!}
                    interactive
                    onButton={handleChromeButton}
                    onCrownWheel={(deltaY, deltaMode) => {
                      const delta = digitalCrownDeltaFromWheel(
                        deltaY,
                        deltaMode,
                        deviceRenderedHeight || 1,
                      );
                      if (delta != null) onStreamDigitalCrown(delta);
                    }}
                    screen={screenContent}
                  />
                );
              })()}
              {mediaDrop.isDragOver && (
                <div
                  // No backdrop-blur here: the canvas underneath repaints every
                  // stream frame, and backdrop-filter forces a full re-blur per
                  // frame for the whole drag — the tint alone stays cheap.
                  className="absolute inset-0 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-accent bg-[color-mix(in_oklch,var(--agentsims-accent)_16%,transparent)] text-accent pointer-events-none z-20"
                  style={{ borderRadius: useChrome ? undefined : imgBorderRadius }}
                >
                  <Upload size={32} strokeWidth={1.5} />
                  <span className="text-[13px] font-medium">Drop media or .ipa</span>
                </div>
              )}
              <SimulatorResizeCornerHandle
                simulatorResize={simulatorResize}
                deviceType={deviceType}
                streamConfig={activeStreamConfig}
                containerWidth={deviceRenderedWidth || simulatorResize.width}
                containerHeight={
                  deviceRenderedHeight ||
                  (containerAspectRatioValue > 0
                    ? simulatorResize.width / containerAspectRatioValue
                    : 0)
                }
              />
              <SimulatorResizeSizeBadge
                width={deviceRenderedWidth || simulatorResize.width}
                height={
                  deviceRenderedHeight ||
                  (containerAspectRatioValue > 0
                    ? simulatorResize.width / containerAspectRatioValue
                    : 0)
                }
                visible={simulatorResize.isResizing || simulatorResize.isInertia}
              />
            </div>
            <div className="inline-flex max-w-full items-center justify-center gap-2">
              <SimulatorToolbar
                exec={execOnHost}
                onRotate={rotateDevice}
                orientation={
                  (activeStreamConfig as { orientation?: SimulatorOrientation }).orientation ?? null
                }
                deviceUdid={config.device}
                deviceName={deviceName}
                deviceRuntime={deviceRuntime}
                streaming={streaming}
                aria-label="Simulator actions"
                className="agentsims-simulator-actions"
                style={{
                  alignSelf: "center",
                  width: "auto",
                  minWidth: 0,
                  maxWidth: "100%",
                  justifyContent: "center",
                  padding: "4px 6px",
                  borderRadius: 10,
                }}
              >
                <SimulatorToolbar.Actions>
                  {currentApp?.isReactNative && (
                    <SimulatorToolbar.Button
                      aria-label="Reload React Native bundle"
                      title="Reload (Cmd+R)"
                      onClick={() => void sendReactNativeReload()}
                    >
                      <ReloadIcon />
                    </SimulatorToolbar.Button>
                  )}
                  {isAndroidDevice ? (
                    <>
                      <SimulatorToolbar.Button
                        aria-label="Back"
                        title="Back"
                        onClick={() => onStreamButton("back")}
                      >
                        <ArrowLeft size={18} strokeWidth={2} />
                      </SimulatorToolbar.Button>
                      <SimulatorToolbar.HomeButton
                        title="Home"
                        onClick={(event) => {
                          event.preventDefault();
                          onStreamButton("home");
                        }}
                      />
                      <SimulatorToolbar.Button
                        aria-label="Recent apps"
                        title="Recent apps"
                        onClick={() => onStreamButton("recent_apps")}
                      >
                        <Menu size={18} strokeWidth={2} />
                      </SimulatorToolbar.Button>
                    </>
                  ) : (
                    <SimulatorToolbar.HomeButton title="Home" />
                  )}
                  <SimulatorToolbar.ScreenshotButton
                    title="Screenshot"
                    onClick={(e) => {
                      e.preventDefault();
                      void captureScreenshot();
                    }}
                  />
                  <SimulatorToolbar.RotateButton title="Rotate device" />
                  <SimulatorToolbar.Button
                    aria-label="Accessibility tree"
                    aria-pressed={accessibilityOpen}
                    title="Accessibility tree"
                    onClick={() => {
                      dispatchReview(
                        accessibilityOpen
                          ? { type: "REVIEW_CLOSED" }
                          : {
                              type: "REVIEW_ACCESSIBILITY_OPENED",
                              picking: false,
                            },
                      );
                    }}
                    style={
                      accessibilityOpen
                        ? {
                            color: "rgba(255, 255, 255, 0.92)",
                            background: "rgba(255, 255, 255, 0.1)",
                          }
                        : undefined
                    }
                  >
                    <ListTree size={18} strokeWidth={2} />
                  </SimulatorToolbar.Button>
                </SimulatorToolbar.Actions>
              </SimulatorToolbar>
              {focused && <ConnectedReviewLaunchers />}
            </div>
            <DeviceScreenshotPreview
              deviceId={config.device}
              preview={screenshotFeedback.preview}
              layout={screenshotPreviewLayout}
              onCopy={() => void screenshotFeedback.copyPreview()}
              onDismiss={screenshotFeedback.dismissPreview}
            />
          </div>

          {(embedded || panelsEnabled) && (
            <ToolsPanel
              open={toolsOpen}
              onClose={() => setToolsOpen(false)}
              udid={config.device}
              deviceName={deviceName}
              deviceRuntime={deviceRuntime}
              currentApp={currentApp}
              codecPreference={codecPreference}
              onCodecPreferenceChange={setCodecPreference}
              activeCodec={useAvccVideo ? "h264" : "mjpeg"}
              avccSupported={avcc.supported}
              width={toolsPanelWidth}
              dock={embedded}
              settingsPosition={settingsPosition}
            />
          )}
          {panelsEnabled && (
            <>
              <ResizeHandle
                panelWidth={toolsPanelWidth}
                visible={toolsOpen && !embedded}
                onPointerDown={onToolsResize}
                ariaLabel="Resize tools panel"
              />

              <WebKitDevtoolsPanel
                open={webkitDevtoolsOpen}
                onClose={() => setDevtoolsOpen(false)}
                udid={config.device}
                targets={devtools.targets}
                selectedTargetId={selectedDevtoolsTargetId}
                onSelectTarget={setSelectedDevtoolsTargetId}
                loading={devtools.loading}
                error={devtools.error}
                onRefresh={() => void devtools.refresh()}
                width={devtoolsPanelWidth}
              />
              <ResizeHandle
                panelWidth={devtoolsPanelWidth}
                visible={webkitDevtoolsOpen}
                onPointerDown={onDevtoolsResize}
                ariaLabel="Resize WebKit DevTools panel"
              />
            </>
          )}
        </div>
      </ReviewDeviceController>
    </AxStateProvider>
  );
}
