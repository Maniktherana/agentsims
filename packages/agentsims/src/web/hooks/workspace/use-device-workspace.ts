import {
	useCallback,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { useGridDevices } from "./use-grid-devices";
import { openHostEventStream } from "../../simulator/input/exec";
import { proxyPreviewConfigForBrowser } from "../../workspace/preview-config";
import { simEndpoint, streamConfigFrom } from "../../preview/sim-endpoint";
import {
	createWorkspaceSelectionState,
	effectiveDeviceId,
	previewConfigKey,
	setPreviewConfigForDevice,
	subscribedWorkspaceDeviceIds,
	workspaceSelectionReducer,
	type PreviewConfig,
} from "../../workspace/workspace-state";
import { DeviceAutoAttachGuard } from "../../workspace/device-auto-attach-guard";
import type { useWorkspaceUrlState } from "../../workspace/url-state";
import type { GridDevice } from "../../workspace/grid";

type WorkspaceUrlState = ReturnType<typeof useWorkspaceUrlState>;

interface DeviceStartResponse {
	device?: string;
	error?: string;
}

interface DeviceShutdownResponse {
	ok?: boolean;
	error?: string;
}

interface GridResponse {
	devices?: Array<{ device?: string; helper?: unknown }>;
}

function initialSelectedDeviceId(config: PreviewConfig | null): string | null {
	return config?.device ?? null;
}

function setInjectedPreviewConfig(config: PreviewConfig | null): void {
	if (config) {
		window.__SIM_PREVIEW__ = config;
		return;
	}
	if (!window.__SIM_PREVIEW__) return;
	const { basePath, execToken } = window.__SIM_PREVIEW__;
	window.__SIM_PREVIEW__ = { basePath, execToken } as Window["__SIM_PREVIEW__"];
}

function previewConfigFromGridDevice(device: GridDevice): PreviewConfig | null {
	if (!device.helper) return null;
	const injected = window.__SIM_PREVIEW__;
	return {
		...injected,
		device: device.device,
		pid: injected?.pid ?? 0,
		port: device.helper.port,
		url: device.helper.url,
		streamUrl: device.helper.streamUrl,
		wsUrl: device.helper.wsUrl,
		basePath: injected?.basePath ?? (simEndpoint("").replace(/\/$/, "") || "/"),
	};
}

export function reconcileStreamingDeviceVisibility(
	current: Readonly<Record<string, boolean>>,
	visibleDeviceIds: readonly string[],
): Record<string, boolean> {
	const visible = new Set(visibleDeviceIds);
	const entries = Object.entries(current).filter(([deviceId]) =>
		visible.has(deviceId),
	);
	if (entries.length === Object.keys(current).length) return current;
	return Object.fromEntries(entries);
}

export function startedDeviceUrlState(
	currentDeviceIds: readonly string[],
	requestedDeviceId: string,
	resolvedDeviceId: string,
): string[] {
	const withoutRequested = currentDeviceIds.filter(
		(id) => id !== requestedDeviceId,
	);
	return withoutRequested.includes(resolvedDeviceId)
		? withoutRequested
		: [...withoutRequested, resolvedDeviceId];
}

/**
 * Owns the browser workspace's device catalog, lifecycle actions, selection,
 * visibility, URL state, and per-device helper subscriptions. Rendering and
 * per-simulator interaction deliberately live outside this controller.
 */
export function useDeviceWorkspace(urlState: WorkspaceUrlState) {
	const [initialConfig] = useState(() =>
		proxyPreviewConfigForBrowser(
			streamConfigFrom(window.__SIM_PREVIEW__),
			window.location,
		),
	);
	const [config, setConfig] = useState<PreviewConfig | null>(initialConfig);
	const [configsByDevice, setConfigsByDevice] = useState<
		Record<string, PreviewConfig | null>
	>(() => (initialConfig ? { [initialConfig.device]: initialConfig } : {}));
	const [selection, dispatchSelection] = useReducer(
		workspaceSelectionReducer,
		initialSelectedDeviceId(initialConfig),
		createWorkspaceSelectionState,
	);
	const [streamingByDevice, setStreamingByDevice] = useState<
		Record<string, boolean>
	>({});
	const [starting, setStarting] = useState<Record<string, boolean>>({});
	const [shuttingDown, setShuttingDown] = useState<Record<string, boolean>>({});
	const [actionErrors, setActionErrors] = useState<
		Record<string, string | null>
	>({});
	const [uiStarted, setUiStarted] = useState<Set<string>>(() => new Set());
	const autoAttachGuardRef = useRef(new DeviceAutoAttachGuard());

	const [endpoints] = useState(() => {
		const preview = window.__SIM_PREVIEW__;
		return {
			grid: preview?.gridApiEndpoint ?? simEndpoint("grid/api"),
			start: preview?.gridStartEndpoint ?? simEndpoint("grid/api/start"),
			shutdown:
				preview?.gridShutdownEndpoint ?? simEndpoint("grid/api/shutdown"),
		};
	});
	const hasPending =
		Object.values(starting).some(Boolean) ||
		Object.values(shuttingDown).some(Boolean);
	const grid = useGridDevices(endpoints.grid, true, hasPending);
	const runningDevices = useMemo(
		() => grid.devices?.filter((device) => !!device.helper) ?? [],
		[grid.devices],
	);
	const runningDeviceIds = useMemo(
		() => runningDevices.map((device) => device.device),
		[runningDevices],
	);
	const availableDeviceIds = useMemo(() => {
		const ids = new Set(runningDeviceIds);
		for (const device of grid.devices ?? []) {
			if (device.state === "Booted" && configsByDevice[device.device]) {
				ids.add(device.device);
			}
		}
		return [...ids];
	}, [configsByDevice, grid.devices, runningDeviceIds]);
	const visibleDeviceIds = useMemo(() => {
		const available = new Set(availableDeviceIds);
		if (urlState.devices === null)
			return [...selection.visibleDeviceIds].filter((id) => available.has(id));
		return urlState.devices.filter((id) => available.has(id));
	}, [availableDeviceIds, selection, urlState.devices]);
	const visibleDeviceIdKey = visibleDeviceIds.join("|");
	useEffect(() => {
		setStreamingByDevice((current) =>
			reconcileStreamingDeviceVisibility(current, visibleDeviceIds),
		);
	}, [visibleDeviceIdKey]);
	const selectedUdid = urlState.focus ?? selection.selectedDeviceId;
	const selectedUdidRef = useRef(selectedUdid);
	selectedUdidRef.current = selectedUdid;
	const selectedHasHelper = !!(
		selectedUdid &&
		grid.devices?.find((device) => device.device === selectedUdid)?.helper
	);
	const subscribedDeviceIds = useMemo(() => {
		return subscribedWorkspaceDeviceIds(
			visibleDeviceIds,
			selectedUdid,
			selectedHasHelper,
		);
	}, [selectedHasHelper, selectedUdid, visibleDeviceIds]);
	const subscribedDeviceIdKey = subscribedDeviceIds.join("|");

	const selectDevice = useCallback(
		(deviceId: string) => {
			dispatchSelection({ type: "select", deviceId });
			void urlState.setFocus(deviceId);
		},
		[urlState.setFocus],
	);

	const setDeviceVisible = useCallback(
		(deviceId: string, visible: boolean) => {
			const current = urlState.devices ?? visibleDeviceIds;
			const next = visible
				? current.includes(deviceId)
					? current
					: [...current, deviceId]
				: current.filter((id) => id !== deviceId);
			const nextFocus = visible
				? deviceId
				: selectedUdid === deviceId
					? (next[0] ?? null)
					: urlState.focus;
			dispatchSelection({ type: "set-visible", deviceId, visible });
			if (!visible && selectedUdid === deviceId) {
				dispatchSelection({ type: "focus-visible", visibleDeviceIds: next });
			}
			void urlState.setDevicesAndFocus(next, nextFocus);
		},
		[
			selectedUdid,
			urlState.devices,
			urlState.focus,
			urlState.setDevicesAndFocus,
			visibleDeviceIds,
		],
	);

	useEffect(() => {
		if (grid.devices === null) return;
		dispatchSelection({
			type: "reconcile-devices",
			devices: grid.devices.map((device) => ({
				...device,
				helper:
					device.helper ??
					(device.state === "Booted" && configsByDevice[device.device]
						? configsByDevice[device.device]
						: null),
			})),
		});
	}, [configsByDevice, grid.devices]);

	useEffect(() => {
		if (!grid.devices) return;
		const devices = grid.devices;
		setConfigsByDevice((previous) => {
			let next = previous;
			for (const device of devices) {
				if (next[device.device]) continue;
				const derived = previewConfigFromGridDevice(device);
				if (derived)
					next = setPreviewConfigForDevice(next, device.device, derived);
			}
			return next;
		});
	}, [grid.devices]);

	const waitForHelper = useCallback(
		async (deviceId: string, timeoutMs = 20_000): Promise<boolean> => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				try {
					const response = await fetch(endpoints.grid, { cache: "no-store" });
					const body = (await response.json()) as GridResponse;
					if (
						(body.devices ?? []).some(
							(device) => device.device === deviceId && !!device.helper,
						)
					) {
						return true;
					}
				} catch (error) {
					console.warn("[agentsims:web] recoverable operation failed", error);
				}
				await new Promise((resolve) => setTimeout(resolve, 400));
			}
			return false;
		},
		[endpoints.grid],
	);

	const requestDeviceStart = useCallback(
		async (deviceId: string, focusDevice = true): Promise<string | null> => {
			setStarting((current) => ({ ...current, [deviceId]: true }));
			setActionErrors((current) => ({ ...current, [deviceId]: null }));
			try {
				const response = await fetch(endpoints.start, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ udid: deviceId }),
				});
				const body = (await response
					.json()
					.catch(() => ({}))) as DeviceStartResponse;
				if (!response.ok || typeof body.device !== "string") {
					setActionErrors((current) => ({
						...current,
						[deviceId]:
							body.error ??
							(response.ok
								? "Invalid device start response"
								: `HTTP ${response.status}`),
					}));
					return null;
				}
				const resolvedDeviceId = body.device;
				dispatchSelection({
					type: "device-started",
					requestedDeviceId: deviceId,
					resolvedDeviceId,
					focus: focusDevice,
				});
				setUiStarted((current) => {
					if (current.has(resolvedDeviceId)) return current;
					const next = new Set(current);
					next.add(resolvedDeviceId);
					return next;
				});
				await waitForHelper(resolvedDeviceId);
				return resolvedDeviceId;
			} catch (error) {
				setActionErrors((current) => ({
					...current,
					[deviceId]: error instanceof Error ? error.message : "Request failed",
				}));
			} finally {
				setStarting((current) => ({ ...current, [deviceId]: false }));
				grid.refresh();
			}
			return null;
		},
		[endpoints.start, grid.refresh, waitForHelper],
	);

	const startDevice = useCallback(
		async (deviceId: string, focusDevice = true) => {
			autoAttachGuardRef.current.beginExplicitStart(deviceId);
			const resolvedDeviceId = await requestDeviceStart(deviceId, focusDevice);
			if (!resolvedDeviceId) return;
			const current = urlState.devices ?? visibleDeviceIds;
			const next = startedDeviceUrlState(current, deviceId, resolvedDeviceId);
			void urlState.setDevicesAndFocus(
				next,
				focusDevice ? resolvedDeviceId : urlState.focus,
			);
		},
		[
			requestDeviceStart,
			urlState.devices,
			urlState.focus,
			urlState.setDevicesAndFocus,
			visibleDeviceIds,
		],
	);

	useEffect(() => {
		if (!grid.devices) return;
		const candidates = autoAttachGuardRef.current.collectCandidates(
			grid.devices,
			starting,
			shuttingDown,
		);
		for (const deviceId of candidates) {
			void requestDeviceStart(deviceId, false).finally(() => {
				window.setTimeout(() => {
					autoAttachGuardRef.current.releaseAutoAttach(deviceId);
				}, 10_000);
			});
		}
	}, [grid.devices, requestDeviceStart, shuttingDown, starting]);

	const shutdownDevice = useCallback(
		async (deviceId: string) => {
			autoAttachGuardRef.current.beginShutdown(deviceId);
			setShuttingDown((current) => ({ ...current, [deviceId]: true }));
			setActionErrors((current) => ({ ...current, [deviceId]: null }));
			let succeeded = false;
			try {
				const response = await fetch(endpoints.shutdown, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ udid: deviceId }),
				});
				const body = (await response
					.json()
					.catch(() => ({}))) as DeviceShutdownResponse;
				if (!response.ok || !body.ok) {
					setActionErrors((current) => ({
						...current,
						[deviceId]: body.error ?? `HTTP ${response.status}`,
					}));
					return;
				}
				succeeded = true;
				setConfigsByDevice((previous) =>
					setPreviewConfigForDevice(previous, deviceId, null),
				);
			} catch (error) {
				setActionErrors((current) => ({
					...current,
					[deviceId]: error instanceof Error ? error.message : "Request failed",
				}));
			} finally {
				if (!succeeded) autoAttachGuardRef.current.failShutdown(deviceId);
				setShuttingDown((current) => ({ ...current, [deviceId]: false }));
				grid.refresh();
			}
		},
		[endpoints.shutdown, grid.refresh],
	);

	useEffect(() => {
		if (selectedUdid) return;
		const candidate =
			config?.device ??
			grid.devices?.find((device) => device.helper)?.device ??
			grid.devices?.find((device) => device.state === "Booted")?.device ??
			grid.devices?.[0]?.device ??
			null;
		dispatchSelection({ type: "select-default", deviceId: candidate });
	}, [config?.device, grid.devices, selectedUdid]);

	useEffect(() => {
		const ids = subscribedDeviceIdKey ? subscribedDeviceIdKey.split("|") : [];
		if (ids.length === 0) return;
		const streams = ids.map((deviceId) => {
			const stream = openHostEventStream(
				`${simEndpoint("api/events")}?device=${encodeURIComponent(deviceId)}`,
			);
			stream.onmessage = (event) => {
				try {
					const next = proxyPreviewConfigForBrowser(
						streamConfigFrom(
							JSON.parse(event.data) as Window["__SIM_PREVIEW__"] | null,
						),
						window.location,
					);
					if (next) {
						setConfigsByDevice((previous) =>
							setPreviewConfigForDevice(previous, deviceId, next),
						);
					}
					if (next && selectedUdidRef.current === deviceId) {
						setConfig((previous) => {
							if (previewConfigKey(previous) === previewConfigKey(next))
								return previous;
							setInjectedPreviewConfig(next);
							return next;
						});
					}
				} catch (error) {
					console.warn("[agentsims:web] recoverable operation failed", error);
				}
			};
			return stream;
		});
		return () => {
			for (const stream of streams) stream.close();
		};
	}, [subscribedDeviceIdKey]);

	useEffect(() => {
		if (!selectedUdid) return;
		if (grid.devices === null) return;
		if (!selectedHasHelper) return;
		const next = configsByDevice[selectedUdid] ?? null;
		if (!next) return;
		setConfig((previous) => {
			if (previewConfigKey(previous) === previewConfigKey(next))
				return previous;
			setInjectedPreviewConfig(next);
			return next;
		});
	}, [configsByDevice, grid.devices, selectedHasHelper, selectedUdid]);

	const previousUrlFocusRef = useRef(urlState.focus);
	useEffect(() => {
		const previousFocus = previousUrlFocusRef.current;
		previousUrlFocusRef.current = urlState.focus;
		if (urlState.focus) {
			dispatchSelection({ type: "select", deviceId: urlState.focus });
			return;
		}
		if (previousFocus) {
			dispatchSelection({ type: "focus-visible", visibleDeviceIds });
		}
	}, [urlState.focus, visibleDeviceIdKey]);

	useEffect(() => {
		if (
			urlState.devices === null ||
			!urlState.focus ||
			urlState.devices.includes(urlState.focus)
		)
			return;
		const nextFocus = visibleDeviceIds[0] ?? null;
		dispatchSelection({ type: "focus-visible", visibleDeviceIds });
		void urlState.setFocus(nextFocus);
	}, [urlState.devices, urlState.focus, urlState.setFocus, visibleDeviceIdKey]);

	const effectiveUdid = effectiveDeviceId(
		selection,
		visibleDeviceIds,
		config?.device ?? null,
		urlState.focus,
	);
	const selectedDevice =
		grid.devices?.find((device) => device.device === effectiveUdid) ?? null;
	const setDeviceStreaming = useCallback((deviceId: string, value: boolean) => {
		setStreamingByDevice((current) => {
			if (!!current[deviceId] === value) return current;
			return { ...current, [deviceId]: value };
		});
	}, []);

	return {
		config,
		configsByDevice,
		streamingByDevice,
		setDeviceStreaming,
		visibleUdids: new Set(visibleDeviceIds),
		visibleDeviceIds,
		selectedUdid,
		effectiveUdid,
		selectedDevice,
		runningDevices,
		gridDevices: grid.devices,
		gridTotal: grid.total,
		gridHasMore: grid.hasMore,
		loadMoreGrid: grid.loadMore,
		loadAllGrid: grid.loadAll,
		resetGridPage: grid.resetPage,
		selectDevice,
		setDeviceVisible,
		startDevice,
		shutdownDevice,
		starting,
		shuttingDown,
		actionErrors,
		uiStarted,
	};
}
