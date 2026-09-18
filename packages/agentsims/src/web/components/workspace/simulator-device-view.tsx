import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { DeviceCanvasShadow } from "./device-canvas-shadow";
import { previewDeviceEndpoint } from "../../workspace/preview-config";
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
	screenCornerShape,
	SimulatorToolbar,
	ROTATE_LEFT_CYCLE,
	ROTATE_RIGHT_CYCLE,
	type SimulatorOrientation,
	type StreamConfig,
} from "../../simulator/index";

import {
	ArrowLeft,
	CodeXml,
	GripVertical,
	ListTree,
	Menu,
	RotateCcw,
	Upload,
} from "lucide-react";
import { IconButton } from "../ui/icon-button";
import { ReloadIcon } from "../icons/index";
import { useSimulatorBounds } from "../../hooks/simulator/use-simulator-bounds";
import { AccessibilityInspectorController } from "../accessibility/controller";
import { AxDomOverlay } from "../accessibility/overlay";
import { AccessibilityStateProvider } from "../accessibility/provider";
import { TracePanel } from "../trace/panel";
import { useAccessibilityPanelPosition } from "../../accessibility/panel-position";
import {
	accessibilityInspectorReducer,
	createAccessibilityInspectorState,
} from "../../accessibility/state";
import {
	DeviceFrame,
	deviceFrameScreenRadius,
	type FrameButtonPress,
} from "../simulator/device-frame";
import {
	ScreenshotPreviewOverlay,
	ScreenshotFlash,
	normalizeScreenshotPng,
	readScreenshotImageSize,
	resolveScreenshotPreviewSidecar,
	type ScreenshotPreviewLayout,
} from "../simulator/screenshot-preview";
import { ResizeHandle } from "../simulator/resize-handle";
import { SimulatorResizeCornerHandle } from "../simulator/simulator-resize-corner-handle";
import { SimulatorResizeSizeBadge } from "../simulator/simulator-resize-size-badge";
import { StreamStatusPill } from "../simulator/stream-status-pill";
import type { DeviceLifecyclePhase } from "../dock/devices/device-row";
import { ToolsPanel } from "../dock/settings/tools-panel";
import {
	CODEC_PREFERENCE_STORAGE_KEY,
	type CodecPreference,
} from "../dock/settings/stream-settings-tool";
import { DevToolsPanel } from "../devtools/devtools-panel";
import { useMediaDrop } from "../../hooks/media/use-media-drop";
import { useScreenshotPreview } from "../../hooks/simulator/use-screenshot-preview";
import { useMjpegStream } from "../../hooks/simulator/use-mjpeg-stream";
import { useAvccStream } from "../../hooks/simulator/use-avcc-support";
import { useResizableWidth } from "../../hooks/simulator/use-resizable-width";
import { useScreenshotToast } from "../../hooks/feedback/use-screenshot-toast";
import { useSimulatorResize } from "../../hooks/simulator/use-simulator-resize";
import { useUploadToasts } from "../../hooks/feedback/use-upload-toasts";
import { useDevTools } from "../../hooks/devtools/use-devtools";
import {
	devToolsTargetsForForegroundApp,
	isForegroundBrowserApp,
} from "../../devtools/availability";
import type { DeviceFrameDescriptor } from "../../workspace/grid";
import {
	avccFallbackReducer,
	initialAvccFallback,
	AVCC_FRAME_TIMEOUT_MS,
} from "../../simulator/stream/avcc-fallback";
import { fileExtension } from "../../media/drop";
import { execOnHost, openHostEventStream } from "../../simulator/input/exec";
import { hidUsageForCode } from "../../simulator/input/hid";
import { PANEL_WIDTH } from "../../workspace/panel-widths";
import { simEndpoint } from "../../preview/sim-endpoint";
import type { RenderedScreenshot } from "../../simulator/screenshot/rendered-screenshot";
import { startScreenshotCapture } from "../../simulator/screenshot/screenshot-capture-flow";
import { downloadScreenshot } from "../../simulator/screenshot/screenshot-save";
import { SimulatorFrameRateStore } from "../../simulator/stream/simulator-frame-rate";
import { resolveSimulatorDeviceLayout } from "../../workspace/simulator-device-layout";
import { WORKSPACE_DEVICE_GEOMETRY_EVENT } from "../../workspace/layout-events";
import {
	flushWsMessageQueue,
	sendOrQueueWsMessage,
	type QueuedWsMessage,
} from "../../simulator/stream/ws-send-queue";
import type { PreviewConfig } from "../../workspace/workspace-state";
import { createAxRefreshScheduler } from "../../workspace/ax-refresh-scheduler";
import { sameStreamConfig } from "../../simulator/android/screen-config-state";
import {
	androidPresentation as resolveAndroidPresentation,
	relativeAndroidOrientation,
	relativeAndroidPlaneStyle,
	retainedAndroidDisplayOrientation,
	type AndroidPresentedFrame,
} from "../../simulator/android/presentation";

import {
	decodeForegroundAppEvent,
	type ForegroundApp,
} from "../../../core/tools/devices/foreground-apps";
const currentAppCache = new Map<string, ForegroundApp>();

export interface SimulatorDeviceViewProps {
	config: PreviewConfig;
	deviceName: string | null;
	deviceRuntime: string | null;
	chrome: DeviceFrameDescriptor | null;
	settingsRefreshRevision?: number;
	toolsOpen: boolean;
	setToolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	devtoolsOpen: boolean;
	setDevtoolsOpen: React.Dispatch<React.SetStateAction<boolean>>;
	selectedDevtoolsTargetId: string | null;
	setSelectedDevtoolsTargetId: React.Dispatch<
		React.SetStateAction<string | null>
	>;
	streaming: boolean;
	lifecyclePhase: DeviceLifecyclePhase;
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
	settingsRefreshRevision = 0,
	toolsOpen,
	setToolsOpen,
	devtoolsOpen,
	setDevtoolsOpen,
	selectedDevtoolsTargetId,
	setSelectedDevtoolsTargetId,
	streaming,
	lifecyclePhase,
	setStreaming,
	embedded = false,
	focused = true,
	settingsPosition = 0,
	onFocus,
}: SimulatorDeviceViewProps) {
	const panelsEnabled = !embedded || focused;
	const [accessibilityState, dispatchAccessibility] = useReducer(
		accessibilityInspectorReducer,
		undefined,
		createAccessibilityInspectorState,
	);
	const [traceOpen, setTraceOpen] = useState(false);
	const accessibilityOpen = accessibilityState.open;
	const accessibilitySelecting = accessibilityState.picking;
	const accessibilityShowAll = accessibilityState.showAllNodes;
	const needsAxSnapshot = accessibilityOpen;
	const focusedRef = useRef(focused);
	focusedRef.current = focused;
	const setStreamingRef = useRef(setStreaming);
	setStreamingRef.current = setStreaming;
	const simulatorFrameRate = useMemo(
		() => new SimulatorFrameRateStore(),
		[config.device],
	);
	const [streamRetry, retryStream] = useReducer(
		(value: number) => value + 1,
		0,
	);
	const [streamStatus, setStreamStatus] = useState("Opening stream");

	useEffect(() => {
		if (!focused) return;
		document.title = deviceName
			? `Simulator - ${deviceName}`
			: "Simulator Preview";
	}, [deviceName, focused]);

	const isAndroidDevice = config.device.startsWith("android:");
	const [currentApp, setCurrentApp] = useState<ForegroundApp | null>(
		() => currentAppCache.get(config.device) ?? null,
	);
	const [axRefreshSignal, requestAxRefresh] = useReducer(
		(value: number) => value + 1,
		0,
	);
	const [axRefreshScheduler] = useState(() =>
		createAxRefreshScheduler(requestAxRefresh),
	);
	const scheduleAxRefresh = useCallback(() => {
		if (!isAndroidDevice || !needsAxSnapshot) return;
		axRefreshScheduler.schedule();
	}, [axRefreshScheduler, isAndroidDevice, needsAxSnapshot]);
	useEffect(() => {
		if (!isAndroidDevice || !needsAxSnapshot) axRefreshScheduler.cancel();
	}, [axRefreshScheduler, isAndroidDevice, needsAxSnapshot]);
	useEffect(() => () => axRefreshScheduler.cancel(), [axRefreshScheduler]);
	const devtools = useDevTools(
		config.devtoolsEndpoint ?? simEndpoint("devtools"),
		panelsEnabled &&
			focused &&
			isForegroundBrowserApp(config.device, currentApp),
	);
	const availableDevToolsTargets = devToolsTargetsForForegroundApp(
		config.device,
		currentApp,
		devtools.targets,
	);
	const devtoolsPanelOpen =
		panelsEnabled && devtoolsOpen && availableDevToolsTargets.length > 0;

	useEffect(() => {
		if (!panelsEnabled || !devtoolsPanelOpen) return;
		if (
			availableDevToolsTargets.some(
				(target) => target.id === selectedDevtoolsTargetId,
			)
		)
			return;
		setSelectedDevtoolsTargetId(availableDevToolsTargets[0]?.id ?? null);
	}, [
		panelsEnabled,
		devtoolsPanelOpen,
		availableDevToolsTargets,
		selectedDevtoolsTargetId,
		setSelectedDevtoolsTargetId,
	]);

	useEffect(() => {
		if (availableDevToolsTargets.length === 0 && devtoolsOpen) {
			setDevtoolsOpen(false);
		}
	}, [availableDevToolsTargets.length, devtoolsOpen, setDevtoolsOpen]);

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
	const [avccFallback, dispatchAvccFallback] = useReducer(
		avccFallbackReducer,
		initialAvccFallback,
	);
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
		window.localStorage.getItem(CODEC_PREFERENCE_STORAGE_KEY) === "mjpeg"
			? "mjpeg"
			: "auto",
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
			!forceMjpeg &&
			codecPreference !== "mjpeg";
	const videoCodec = isAndroidDevice ? "avcc" : useAvccVideo ? "avcc" : "mjpeg";
	const mjpeg = useMjpegStream(
		useAvccVideo || isAndroidDevice ? null : config.streamUrl,
		streamRetry,
	);

	// Re-arm AVCC whenever the target stream changes (device switch / reconnect).
	useEffect(() => {
		dispatchAvccFallback("reset");
	}, [config.streamUrl]);
	// The mounted stream owns its status, including an interrupted exit/reveal.
	// Hiding a device does not disconnect it until the exit has actually finished.
	useEffect(() => () => setStreamingRef.current(false), [config.device]);
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
		const timer = setTimeout(
			() => dispatchAvccFallback("timeout"),
			AVCC_FRAME_TIMEOUT_MS,
		);
		return () => clearTimeout(timer);
	}, [isAndroidDevice, useAvccVideo, config.streamUrl]);
	// Screen config now arrives over the input WebSocket (pushed by the helper on
	// connect + on every dimension/orientation change) instead of a 1s /config poll.
	const [wsStreamConfig, setWsStreamConfig] = useState<StreamConfig | null>(
		null,
	);
	const wsStreamConfigRef = useRef<StreamConfig | null>(null);
	wsStreamConfigRef.current = wsStreamConfig;
	const [presentedAndroidFrame, setPresentedAndroidFrame] =
		useState<AndroidPresentedFrame | null>(null);
	const [desiredOrientation, setDesiredOrientation] =
		useState<SimulatorOrientation | null>(null);
	const retainedDisplayOrientationRef = useRef<SimulatorOrientation | null>(
		null,
	);
	const retainedDisplayDeviceRef = useRef(config.device);
	if (retainedDisplayDeviceRef.current !== config.device) {
		retainedDisplayDeviceRef.current = config.device;
		retainedDisplayOrientationRef.current = null;
	}
	const streamConfig = wsStreamConfig;
	const initialDeviceLayout = resolveSimulatorDeviceLayout({
		deviceName,
		chrome,
	});
	const displayOrientation = retainedAndroidDisplayOrientation(
		retainedDisplayOrientationRef.current,
		desiredOrientation,
		streamConfig?.orientation ?? initialDeviceLayout.streamConfig?.orientation,
	);
	retainedDisplayOrientationRef.current = displayOrientation;
	const presentationConfig = useMemo(() => {
		const canonical = streamConfig ?? initialDeviceLayout.streamConfig;
		if (!canonical) return canonical;
		const landscape = displayOrientation.startsWith("landscape");
		return {
			...canonical,
			width: landscape
				? Math.max(canonical.width, canonical.height)
				: Math.min(canonical.width, canonical.height),
			height: landscape
				? Math.min(canonical.width, canonical.height)
				: Math.max(canonical.width, canonical.height),
			orientation: displayOrientation,
		};
	}, [displayOrientation, initialDeviceLayout.streamConfig, streamConfig]);
	const androidPresentation = useMemo(
		() => resolveAndroidPresentation(presentationConfig, presentedAndroidFrame),
		[presentationConfig, presentedAndroidFrame],
	);
	const androidPresentationPending = false;
	const activeStreamConfig = isAndroidDevice
		? (presentationConfig ?? initialDeviceLayout.streamConfig)
		: (streamConfig ?? initialDeviceLayout.streamConfig);
	const relativeInputOrientation = streamConfig
		? relativeAndroidOrientation(displayOrientation, streamConfig.orientation)
		: "portrait";
	const absoluteOrientation = displayOrientation;
	const absoluteSameAspectPlane = relativeAndroidPlaneStyle(
		androidPresentation.displayConfig,
		absoluteOrientation === "portrait_upside_down"
			? "portrait_upside_down"
			: "portrait",
	);
	const effectivePlane =
		absoluteOrientation === "portrait" ||
		absoluteOrientation === "portrait_upside_down"
			? absoluteSameAspectPlane
			: {
					rotationDegrees: androidPresentation.rotationDegrees,
					planeStyle: androidPresentation.planeStyle,
				};
	const deviceLayout = resolveSimulatorDeviceLayout({
		deviceName,
		chrome,
		streamConfig: activeStreamConfig,
	});
	const {
		deviceType,
		useDeviceFrame,
		defaultWidth: containerDefaultWidth,
		aspectRatio: containerAspectRatio,
		aspectRatioValue: containerAspectRatioValue,
	} = deviceLayout;
	const imgBorderRadius = screenBorderRadius(deviceType, activeStreamConfig);
	const hasRoundedScreen = imgBorderRadius !== "0px";
	const imgCornerShape = useDeviceFrame
		? undefined
		: screenCornerShape(deviceType, activeStreamConfig);

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
				pendingWsMessagesRef.current = flushWsMessageQueue(
					ws,
					pendingWsMessagesRef.current,
				);
			};
			ws.onmessage = (ev) => {
				// Server -> client screen-config push (tag 0x82): [tag][JSON].
				if (!(ev.data instanceof ArrayBuffer)) return;
				const bytes = new Uint8Array(ev.data);
				if (bytes.length < 1 || bytes[0] !== 0x82) return;
				try {
					const cfg = JSON.parse(
						new TextDecoder().decode(bytes.subarray(1)),
					) as StreamConfig;
					if (cfg.width <= 0 || cfg.height <= 0) return;
					setWsStreamConfig((prev) =>
						sameStreamConfig(prev, cfg) ? prev : cfg,
					);
				} catch (error) {
					console.warn("[agentsims:web] recoverable operation failed", error);
				}
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
	const handleFrameButton = useCallback(
		({ phase, button }: FrameButtonPress) => {
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
	const onStreamDigitalCrown = useCallback(
		(delta: number) => sendWs(0x0a, { delta }),
		[sendWs],
	);
	const onStreamScroll = useCallback(
		(data: { dx: number; dy: number; x: number; y: number }) => {
			sendWs(0x0b, data);
		},
		[sendWs],
	);
	const onScreenConfigChange = useCallback((next: StreamConfig) => {
		setWsStreamConfig((prev) => (sameStreamConfig(prev, next) ? prev : next));
	}, []);
	const onPresentedFrame = useCallback(
		(size: AndroidPresentedFrame) => {
			if (!isAndroidDevice) return;
			setPresentedAndroidFrame((prev) =>
				prev?.width === size.width &&
				prev.height === size.height &&
				prev.presentationGeneration === size.presentationGeneration
					? prev
					: size,
			);
		},
		[isAndroidDevice],
	);
	const rotateDevice = useCallback(
		(orientation: SimulatorOrientation) => {
			if (isAndroidDevice) setDesiredOrientation(orientation);
			sendWs(0x07, { orientation });
			scheduleAxRefresh();
		},
		[isAndroidDevice, scheduleAxRefresh, sendWs],
	);
	const currentOrientation =
		desiredOrientation ??
		(activeStreamConfig as { orientation?: SimulatorOrientation })
			.orientation ??
		"portrait";
	const canRotate = deviceType !== "watch" && deviceType !== "vision";
	const rotateBy = useCallback(
		(direction: "left" | "right") => {
			if (!canRotate) return;
			const next = (
				direction === "left" ? ROTATE_LEFT_CYCLE : ROTATE_RIGHT_CYCLE
			)[currentOrientation];
			rotateDevice(next);
		},
		[canRotate, currentOrientation, rotateDevice],
	);

	useEffect(() => {
		setPresentedAndroidFrame(null);
		setDesiredOrientation(null);
		setWsStreamConfig(null);
	}, [config.streamUrl]);

	const sendKey = useCallback(
		(type: "down" | "up", usage: number) => {
			sendWs(0x06, { type, usage });
			if (type === "up") scheduleAxRefresh();
		},
		[scheduleAxRefresh, sendWs],
	);

	const { width: toolsPanelWidth, onPointerDown: onToolsResize } =
		useResizableWidth("agentsims:tools-panel-width", PANEL_WIDTH, 240, 720);

	useEffect(() => {
		let active = true;
		const es = openHostEventStream(
			previewDeviceEndpoint(
				config.appStateEndpoint ?? simEndpoint("appstate"),
				config.device,
			),
		);
		es.onmessage = (event) => {
			if (!active) return;
			const next = decodeForegroundAppEvent(event.data);
			if (!next) return;
			currentAppCache.set(config.device, next);
			setCurrentApp(next);
		};
		return () => {
			active = false;
			es.close();
		};
	}, [config.appStateEndpoint, config.device, settingsRefreshRevision]);

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
		return () =>
			document.removeEventListener("pointerdown", onPointerDown, true);
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
				(target.matches("input, textarea, select") ||
					target.closest("[contenteditable='true']"))
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
								return execOnHost(
									`xcrun simctl ui ${config.device} appearance ${next}`,
								);
							})
							.catch(() => {});
					}
				}
				return;
			}
			if (
				e.code === "KeyK" &&
				e.metaKey &&
				!e.shiftKey &&
				!e.altKey &&
				!e.ctrlKey
			) {
				e.preventDefault();
				if (type === "down" && !e.repeat) sendWs(0x0c, {});
				return;
			}
			// Unhandled Command shortcuts belong to the browser, not Android's
			// Meta key (which opens its launcher). Never forward the modifier.
			if (e.metaKey || e.code === "MetaLeft" || e.code === "MetaRight") return;
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
	const screenshot = useScreenshotToast();
	const screenshotPreview = useScreenshotPreview(screenshot.reportCopied);
	const [screenshotPreviewLayout, setScreenshotPreviewLayout] =
		useState<ScreenshotPreviewLayout | null>(null);
	const measuredScreenshotRef = useRef<{
		id: string;
		hasVisualPlacement: boolean;
	} | null>(null);
	const screenshotRequestRef = useRef<AbortController | null>(null);
	const capturePresentedSurfaceRef = useRef<
		(() => RenderedScreenshot | null) | null
	>(null);
	const onCapturePresentedSurfaceChange = useCallback(
		(capture: (() => RenderedScreenshot | null) | null) => {
			capturePresentedSurfaceRef.current = capture;
		},
		[],
	);

	const saveCapturedScreenshot = useCallback(
		async (blob: Blob, signal: AbortSignal) => {
			downloadScreenshot(blob, config.device, signal);
			screenshot.reportSaved();
		},
		[config.device, screenshot],
	);

	const captureDeviceScreenshot = useCallback(
		async (controller: AbortController) => {
			const screenshotUrl = new URL(
				"screenshot.png",
				config.streamUrl,
			).toString();
			const res = await fetch(screenshotUrl, {
				cache: "no-store",
				signal: controller.signal,
			});
			if (!res.ok) throw new Error(`Screenshot failed (${res.status})`);
			const blob = await normalizeScreenshotPng(await res.blob());
			if (controller.signal.aborted)
				throw new DOMException("Aborted", "AbortError");
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

	const resetScreenshotFeedback = screenshotPreview.reset;
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
				const screenRect = screenSurfaceRef.current?.getBoundingClientRect();
				const frameRect = simContainerRef.current?.getBoundingClientRect();
				const source = screenRect
					? {
							left: screenRect.left,
							top: screenRect.top,
							width: screenRect.width,
							height: screenRect.height,
							borderRadius:
								useDeviceFrame && chrome
									? deviceFrameScreenRadius(chrome)
									: imgBorderRadius,
							cornerShape: imgCornerShape,
						}
					: undefined;
				// The flash covers the phone body; the captured image starts at its
				// screen opening. Both use viewport coordinates above the portal.
				const flashSource =
					useDeviceFrame && chrome && frameRect
						? {
								left:
									frameRect.left +
									(chrome.body.x / chrome.frame.width) * frameRect.width,
								top:
									frameRect.top +
									(chrome.body.y / chrome.frame.height) * frameRect.height,
								width:
									(chrome.body.width / chrome.frame.width) * frameRect.width,
								height:
									(chrome.body.height / chrome.frame.height) * frameRect.height,
								borderRadius: `${(chrome.outerCornerRadius / chrome.body.width) * 100}% / ${(chrome.outerCornerRadius / chrome.body.height) * 100}%`,
							}
						: source;
				return {
					id: crypto.randomUUID(),
					...rendered,
					source,
					flashSource,
					save: (signal: AbortSignal) =>
						saveCapturedScreenshot(rendered.blob, signal),
					cancel: () => controller.abort(),
				};
			},
			begin: screenshotPreview.beginCapture,
			captureAuthoritative: () => captureDeviceScreenshot(controller),
			replace: screenshotPreview.replaceCapture,
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
	}, [
		captureDeviceScreenshot,
		chrome,
		imgBorderRadius,
		imgCornerShape,
		saveCapturedScreenshot,
		screenshot,
		screenshotPreview,
		useDeviceFrame,
	]);

	useLayoutEffect(() => {
		const preview = screenshotPreview.preview;
		const screen = screenSurfaceRef.current;
		const stack = deviceStackRef.current;
		if (!preview || !screen || !stack) {
			measuredScreenshotRef.current = null;
			setScreenshotPreviewLayout(null);
			return;
		}

		let frame: number | null = null;
		const measure = () => {
			const screenRect = screen.getBoundingClientRect();
			const placement = resolveScreenshotPreviewSidecar({
				screen: screenRect,
				capture: preview,
				viewport: { width: window.innerWidth, height: window.innerHeight },
			});
			const next = placement;
			measuredScreenshotRef.current = {
				id: preview.id,
				hasVisualPlacement: Boolean(placement),
			};
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
		};
		const refresh = () => {
			if (frame != null) return;
			frame = requestAnimationFrame(() => {
				frame = null;
				measure();
			});
		};
		const onGeometry = (event: Event) => {
			const detail = (event as CustomEvent<{ deviceId?: string }>).detail;
			if (!detail?.deviceId || detail.deviceId === config.device) refresh();
		};
		const resizeObserver =
			typeof ResizeObserver === "undefined"
				? null
				: new ResizeObserver(refresh);
		resizeObserver?.observe(screen);
		resizeObserver?.observe(stack);
		window.addEventListener("resize", refresh);
		window.addEventListener("scroll", refresh, true);
		window.addEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
		measure();
		return () => {
			if (frame != null) cancelAnimationFrame(frame);
			resizeObserver?.disconnect();
			window.removeEventListener("resize", refresh);
			window.removeEventListener("scroll", refresh, true);
			window.removeEventListener(WORKSPACE_DEVICE_GEOMETRY_EVENT, onGeometry);
		};
	}, [
		config.device,
		screenshotPreview.preview?.height,
		screenshotPreview.preview?.id,
		screenshotPreview.preview?.width,
	]);
	useEffect(() => {
		if (
			screenshotPreview.preview &&
			measuredScreenshotRef.current?.id === screenshotPreview.preview.id &&
			!measuredScreenshotRef.current.hasVisualPlacement
		) {
			screenshotPreview.markPreviewReady(
				screenshotPreview.preview.id,
				Boolean(screenshotPreviewLayout),
			);
		}
	}, [
		screenshotPreview.markPreviewReady,
		screenshotPreview.preview,
		screenshotPreviewLayout,
	]);
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
		onHostPathDrop: screenshotPreview.dismissPreview,
	});

	const tracePanelPosition = useAccessibilityPanelPosition(
		simContainerRef.current,
		traceOpen,
		`trace:${config.device}`,
	);
	const tracePanel = createPortal(
		<AnimatePresence>
			{traceOpen && focused && (
				<div
					key={config.device}
					ref={tracePanelPosition.panelRef}
					data-agentsims-trace-panel-host
					style={tracePanelPosition.style}
				>
					<TracePanel
						open
						device={{
							id: config.device,
							name: deviceName ?? config.device,
							platform: isAndroidDevice ? "android" : "ios",
							runtime: deviceRuntime,
							applicationName: currentApp?.bundleId ?? null,
							connected: streaming,
						}}
						onClose={() => setTraceOpen(false)}
						onMovePointerDown={tracePanelPosition.onMovePointerDown}
						onResizePointerDown={tracePanelPosition.onResizePointerDown}
						onResizeKeyDown={tracePanelPosition.onResizeKeyDown}
					/>
				</div>
			)}
		</AnimatePresence>,
		document.body,
	);

	const simulatorBounds = useSimulatorBounds(deviceStackRef, simContainerRef);
	const simulatorResize = useSimulatorResize({
		deviceId: config.device,
		defaultWidth: containerDefaultWidth,
		viewportWidth: simulatorBounds.width,
		viewportHeight: simulatorBounds.height,
		aspectRatio: containerAspectRatioValue,
		onStart: () => setSimFocused(false),
	});

	return (
		<AccessibilityStateProvider
			endpoint={config?.axEndpoint}
			refreshSignal={axRefreshSignal}
			state={accessibilityState}
			dispatch={dispatchAccessibility}
		>
			<AccessibilityInspectorController
				state={accessibilityState}
				dispatch={dispatchAccessibility}
				focused={focused}
				anchor={simContainerRef.current}
				deviceId={config.device}
				deviceName={deviceName}
				deviceRuntime={deviceRuntime}
				applicationName={currentApp?.bundleId ?? null}
				connected={streaming}
			>
				<div
					className={`flex flex-col items-center justify-center gap-3 font-system box-border ${
						embedded ? "relative bg-transparent" : "h-screen bg-page py-6"
					}`}
					style={{
						paddingInline: embedded ? 0 : 24,
					}}
					onPointerDownCapture={(event) => {
						if (event.currentTarget.contains(event.target as Node)) onFocus?.();
					}}
				>
					{embedded && (
						<DeviceCanvasShadow
							frame={simContainerRef}
							chrome={useDeviceFrame ? chrome : null}
							borderRadius={imgBorderRadius}
						/>
					)}
					<div
						ref={deviceStackRef}
						className="relative flex flex-col items-center gap-3 min-w-0 [&:fullscreen]:justify-center [&:fullscreen]:bg-page [&:fullscreen]:p-4"
						style={{
							width: Math.max(
								simulatorResize.width,
								isAndroidDevice ? 240 : 160,
							),
						}}
					>
						<SimulatorToolbar
							exec={execOnHost}
							onRotate={rotateDevice}
							orientation={
								desiredOrientation ??
								(activeStreamConfig as { orientation?: SimulatorOrientation })
									.orientation ??
								null
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
								maxWidth: "none",
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
							<StreamStatusPill
								phase={lifecyclePhase}
								frameRate={simulatorFrameRate}
								status={streamStatus}
							/>
							{!streaming && lifecyclePhase !== "shutting-down" ? (
								<IconButton
									surface="toolbar"
									size="row"
									label="Retry stream"
									style={{ width: 16, height: 16 }}
									onClick={(event) => {
										event.stopPropagation();
										setStreamStatus("Opening stream");
										dispatchAvccFallback("reset");
										retryStream();
									}}
									className="!size-4 !min-h-0 !min-w-0 !border-transparent !p-0"
								>
									<RotateCcw size={13} strokeWidth={2} />
								</IconButton>
							) : null}
						</SimulatorToolbar>
						<div
							ref={simContainerRef}
							data-agentsims-device-frame={config.device}
							data-cutout-edge={
								isAndroidDevice ? androidPresentation.cutoutEdge : undefined
							}
							data-presentation-pending={
								androidPresentationPending ? "true" : "false"
							}
							className="relative max-h-full"
							style={{
								width: simulatorResize.width,
								aspectRatio: containerAspectRatio,
							}}
							{...mediaDrop.dropZoneProps}
						>
							{(() => {
								const streamView = (
									<SimulatorView
										key={`${config.streamUrl}:${streamRetry}`}
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
												borderRadius: useDeviceFrame ? 0 : imgBorderRadius,
												cornerShape: imgCornerShape,
												...(useDeviceFrame || !hasRoundedScreen
													? {}
													: {
															boxShadow:
																"inset 0 0 0 1px rgba(255, 255, 255, 0.2)",
														}),
											} as CSSProperties
										}
										hideControls
										onStreamingChange={setStreaming}
										onStreamStatusChange={setStreamStatus}
										frameRate={simulatorFrameRate}
										onStreamTouch={onStreamTouch}
										onStreamMultiTouch={onStreamMultiTouch}
										onStreamButton={onStreamButton}
										onStreamDigitalCrown={onStreamDigitalCrown}
										onStreamScroll={onStreamScroll}
										codec={videoCodec}
										onAvccError={
											isAndroidDevice
												? undefined
												: () => dispatchAvccFallback("error")
										}
										subscribeFrame={
											useAvccVideo || isAndroidDevice
												? undefined
												: mjpeg.subscribeFrame
										}
										streamFrame={
											useAvccVideo || isAndroidDevice ? undefined : mjpeg.frame
										}
										streamConfig={activeStreamConfig}
										enableDigitalCrown={deviceType === "watch"}
										maxInputFps={isAndroidDevice ? 60 : undefined}
										relayInputCoordinates={isAndroidDevice ? "display" : "raw"}
										onScreenConfigChange={onScreenConfigChange}
										onPresentedFrame={onPresentedFrame}
										inputDisabled={
											isAndroidDevice &&
											accessibilityOpen &&
											accessibilitySelecting
										}
										presentationPlaneStyle={
											isAndroidDevice ? effectivePlane.planeStyle : undefined
										}
										presentationOrientation={
											isAndroidDevice ? displayOrientation : undefined
										}
										presentationRotationDegrees={
											isAndroidDevice
												? effectivePlane.rotationDegrees
												: undefined
										}
										presentationOverlay={
											isAndroidDevice && accessibilityOpen ? (
												<AxDomOverlay
													mode={
														accessibilitySelecting
															? "inspect-select"
															: "inspect-passive"
													}
													showAllOutlines={accessibilityShowAll}
													onSelectTarget={() => {
														dispatchAccessibility({
															type: "PICKING_CHANGED",
															picking: false,
														});
													}}
												/>
											) : undefined
										}
										visibleInputOrientation={
											isAndroidDevice ? relativeInputOrientation : undefined
										}
										onCapturePresentedSurfaceChange={
											onCapturePresentedSurfaceChange
										}
									/>
								);
								const rawScreenContent = (
									<>
										{streamView}
										{!isAndroidDevice && accessibilityOpen ? (
											<AxDomOverlay
												mode={
													accessibilitySelecting
														? "inspect-select"
														: "inspect-passive"
												}
												showAllOutlines={accessibilityShowAll}
												onSelectTarget={() => {
													dispatchAccessibility({
														type: "PICKING_CHANGED",
														picking: false,
													});
												}}
											/>
										) : null}
										<div
											ref={screenSurfaceRef}
											data-agentsims-device-screen={config.device}
											className="pointer-events-none absolute inset-0"
										>
											<ScreenshotFlash
												deviceId={config.device}
												flash={screenshotPreview.flash}
												borderRadius={
													useDeviceFrame ? undefined : imgBorderRadius
												}
											/>
										</div>
									</>
								);
								const screenContent = useDeviceFrame ? (
									rawScreenContent
								) : (
									<div
										className="absolute inset-0 overflow-hidden"
										data-agentsims-screen-clip={config.device}
										style={
											{
												borderRadius: imgBorderRadius,
												cornerShape: imgCornerShape,
											} as CSSProperties
										}
									>
										{rawScreenContent}
									</div>
								);
								if (!useDeviceFrame) return screenContent;
								// The screen slot is the bezel's true opening; the stream letterboxes
								// (contains) inside it, filling the constraining axis and leaving a
								// thin black margin on the other — the device's own black screen
								// border. Containing (not covering) keeps the stream from ever
								// overflowing past the bezel.
								return (
									<DeviceFrame
										chrome={chrome!}
										interactive
										onButton={handleFrameButton}
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
									style={{
										borderRadius: useDeviceFrame ? undefined : imgBorderRadius,
									}}
								>
									<Upload size={32} strokeWidth={1.5} />
									<span className="text-[13px] font-medium">
										Drop media or .ipa
									</span>
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
								visible={
									simulatorResize.isResizing || simulatorResize.isInertia
								}
							/>
						</div>
						<div className="inline-flex max-w-full items-center justify-center gap-2">
							<SimulatorToolbar
								exec={execOnHost}
								onRotate={rotateDevice}
								orientation={
									desiredOrientation ??
									(activeStreamConfig as { orientation?: SimulatorOrientation })
										.orientation ??
									null
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
										onClick={(event) => {
											event.preventDefault();
											void captureScreenshot();
										}}
									/>
									<SimulatorToolbar.RecordButton />
									<SimulatorToolbar.RotateButton title="Rotate device" />
									{availableDevToolsTargets.length > 0 && (
										<SimulatorToolbar.Button
											aria-label="Browser DevTools"
											aria-pressed={devtoolsPanelOpen}
											title="Browser DevTools"
											onClick={() => setDevtoolsOpen(!devtoolsPanelOpen)}
											style={
												devtoolsPanelOpen
													? {
															color: "rgba(255, 255, 255, 0.92)",
															background: "rgba(255, 255, 255, 0.1)",
														}
													: undefined
											}
										>
											<CodeXml size={18} strokeWidth={2} />
										</SimulatorToolbar.Button>
									)}
									<SimulatorToolbar.Button
										aria-label="Accessibility tree"
										aria-pressed={accessibilityOpen}
										title="Accessibility tree"
										onClick={() => {
											dispatchAccessibility({ type: "TOGGLE" });
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
						</div>
						<ScreenshotPreviewOverlay
							deviceId={config.device}
							preview={screenshotPreview.preview}
							layout={screenshotPreviewLayout}
							borderRadius={imgBorderRadius}
							onReady={() => {
								if (screenshotPreview.preview)
									screenshotPreview.markPreviewReady(
										screenshotPreview.preview.id,
									);
							}}
							onExitComplete={() => {
								if (screenshotPreview.preview)
									screenshotPreview.finishPreviewExit(
										screenshotPreview.preview.id,
									);
							}}
							onCopy={() => void screenshotPreview.copyPreview()}
							onInteractionChange={screenshotPreview.setPreviewInteracting}
							onDismiss={screenshotPreview.dismissPreview}
						/>
					</div>

					{(embedded || panelsEnabled) && (
						<ToolsPanel
							refreshRevision={settingsRefreshRevision}
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
							frameRate={simulatorFrameRate}
							width={toolsPanelWidth}
							dock={embedded}
							settingsPosition={settingsPosition}
							traceOpen={traceOpen}
							onTraceOpenChange={setTraceOpen}
						/>
					)}
					{panelsEnabled && !embedded && (
						<ResizeHandle
							panelWidth={toolsPanelWidth}
							visible={toolsOpen}
							onPointerDown={onToolsResize}
							ariaLabel="Resize tools panel"
						/>
					)}
					{panelsEnabled && tracePanel}
					{panelsEnabled && (
						<DevToolsPanel
							open={devtoolsPanelOpen}
							onClose={() => setDevtoolsOpen(false)}
							anchor={simContainerRef.current}
							udid={config.device}
							deviceName={deviceName ?? config.device}
							targets={availableDevToolsTargets}
							selectedTargetId={selectedDevtoolsTargetId}
							onSelectTarget={setSelectedDevtoolsTargetId}
							loading={devtools.loading}
							error={devtools.error}
						/>
					)}
				</div>
			</AccessibilityInspectorController>
		</AccessibilityStateProvider>
	);
}
