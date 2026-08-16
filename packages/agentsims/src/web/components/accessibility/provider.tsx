import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import type { AxSnapshot } from "../../../accessibility/model";
import { openHostEventStream } from "../../simulator/input/exec";
import {
	axElementKey,
	axElementsEqual,
	isAxeUnavailable,
} from "../../accessibility/ax";
import type {
	AccessibilityInspectorEvent,
	AccessibilityInspectorState,
	AxHighlightOrigin,
} from "../../accessibility/state";

export interface DecodedAxSnapshotEvent {
	payload: string;
	snapshot: AxSnapshot;
	status: string;
}

export function decodeAxSnapshotEvent(
	payload: string,
	previousPayload: string | null,
): DecodedAxSnapshotEvent | null {
	if (payload === previousPayload) return null;
	const snapshot = JSON.parse(payload) as AxSnapshot;
	return {
		payload,
		snapshot,
		status: isAxeUnavailable(snapshot)
			? "AX unavailable"
			: snapshot.errors?.[0] || `${snapshot.elements.length} AX elements`,
	};
}

function sameStrings(
	previous: readonly string[] | undefined,
	next: readonly string[] | undefined,
): boolean {
	if (previous === next) return true;
	if (!previous || !next || previous.length !== next.length) return false;
	return previous.every((value, index) => value === next[index]);
}

export function reconcileAxSnapshot(
	previous: AxSnapshot | null,
	next: AxSnapshot,
): AxSnapshot {
	if (!previous) return next;
	const previousByKey = new Map(
		previous.elements.map((element) => [axElementKey(element), element]),
	);
	let changed = previous.elements.length !== next.elements.length;
	const elements = next.elements.map((element) => {
		const previousElement = previousByKey.get(axElementKey(element));
		if (previousElement && axElementsEqual(previousElement, element)) {
			return previousElement;
		}
		changed = true;
		return element;
	});
	const sameScreen =
		previous.screen.width === next.screen.width &&
		previous.screen.height === next.screen.height;
	const sameErrors = sameStrings(previous.errors, next.errors);
	if (!changed && sameScreen && sameErrors) return previous;
	return {
		...next,
		screen: sameScreen ? previous.screen : next.screen,
		elements,
		...(sameErrors ? { errors: previous.errors } : {}),
	};
}

export function axRefreshEndpoint(endpoint: string): string {
	const queryIndex = endpoint.indexOf("?");
	const path = queryIndex >= 0 ? endpoint.slice(0, queryIndex) : endpoint;
	const query = queryIndex >= 0 ? endpoint.slice(queryIndex) : "";
	const refreshPath = path.endsWith("/ax")
		? `${path}/refresh`
		: `${path.replace(/\/+$/, "")}/refresh`;
	return `${refreshPath}${query}`;
}

export function axSourceEndpoint(endpoint: string): string {
	const queryIndex = endpoint.indexOf("?");
	const path = queryIndex >= 0 ? endpoint.slice(0, queryIndex) : endpoint;
	const query = queryIndex >= 0 ? endpoint.slice(queryIndex) : "";
	const sourcePath = path.endsWith("/ax")
		? `${path.slice(0, -3)}/source`
		: `${path.replace(/\/+$/, "")}/source`;
	return `${sourcePath}${query}`;
}

export function useAxSnapshot(endpoint?: string, refreshSignal?: number) {
	const [snapshot, setSnapshot] = useState<AxSnapshot | null>(null);
	const [status, setStatus] = useState("AX off");
	const [refreshing, setRefreshing] = useState(false);
	const latestEndpointRef = useRef<string | null>(null);
	const latestPayloadRef = useRef<string | null>(null);
	const latestSnapshotRef = useRef<AxSnapshot | null>(null);
	const latestStatusRef = useRef("AX off");
	const latestRefreshSignalRef = useRef(refreshSignal);

	const refresh = useCallback(async () => {
		if (!endpoint) return;
		setRefreshing(true);
		try {
			const response = await fetch(axRefreshEndpoint(endpoint), {
				method: "POST",
			});
			if (!response.ok)
				throw new Error(`AX refresh failed (${response.status})`);
		} catch {
			latestStatusRef.current = "AX refresh failed";
			setStatus("AX refresh failed");
			setRefreshing(false);
		}
	}, [endpoint]);

	useEffect(() => {
		if (!endpoint) {
			setRefreshing(false);
			return;
		}
		if (
			latestEndpointRef.current !== null &&
			latestEndpointRef.current !== endpoint
		) {
			latestPayloadRef.current = null;
			latestSnapshotRef.current = null;
			latestStatusRef.current = "AX waiting";
			setSnapshot(null);
			setStatus("AX waiting");
		} else if (latestPayloadRef.current === null) {
			latestStatusRef.current = "AX waiting";
			setStatus("AX waiting");
		}
		latestEndpointRef.current = endpoint;

		let source: ReturnType<typeof openHostEventStream> | null = null;
		let disposed = false;
		const disconnect = () => {
			source?.close();
			source = null;
		};
		const connect = () => {
			if (
				disposed ||
				source ||
				(typeof document !== "undefined" && document.hidden)
			)
				return;
			source = openHostEventStream(endpoint);
			source.onmessage = (event) => {
				setRefreshing(false);
				try {
					const next = decodeAxSnapshotEvent(
						event.data,
						latestPayloadRef.current,
					);
					if (!next) {
						setStatus((current) =>
							current === latestStatusRef.current
								? current
								: latestStatusRef.current,
						);
						return;
					}
					latestPayloadRef.current = next.payload;
					latestStatusRef.current = next.status;
					const reconciled = reconcileAxSnapshot(
						latestSnapshotRef.current,
						next.snapshot,
					);
					latestSnapshotRef.current = reconciled;
					setSnapshot((current) =>
						current === reconciled ? current : reconciled,
					);
					setStatus((current) =>
						current === next.status ? current : next.status,
					);
				} catch {
					setStatus((current) =>
						current === "AX parse error" ? current : "AX parse error",
					);
				}
			};
			source.onerror = () => {
				setStatus((current) =>
					current === "AX reconnecting" ? current : "AX reconnecting",
				);
			};
		};
		const onVisibilityChange = () => {
			if (document.hidden) disconnect();
			else connect();
		};
		connect();
		document.addEventListener("visibilitychange", onVisibilityChange);
		return () => {
			disposed = true;
			document.removeEventListener("visibilitychange", onVisibilityChange);
			disconnect();
		};
	}, [endpoint]);

	useEffect(() => {
		if (
			refreshSignal === undefined ||
			latestRefreshSignalRef.current === refreshSignal
		)
			return;
		latestRefreshSignalRef.current = refreshSignal;
		if (endpoint) void refresh();
	}, [endpoint, refresh, refreshSignal]);

	return {
		snapshot,
		status: refreshing ? "Refreshing AX…" : status,
		refreshing,
		refresh,
		sourceEndpoint: endpoint ? axSourceEndpoint(endpoint) : undefined,
	};
}

export interface AxSnapshotContextValue {
	snapshot: AxSnapshot | null;
	status: string;
	refreshing: boolean;
	refresh: () => Promise<void>;
	sourceEndpoint?: string;
}

export interface AxSelectionContextValue {
	highlightedKey: string | null;
	highlightedOrigin: AxHighlightOrigin;
	selectedKey: string | null;
	setHighlightedKey: (
		key: string | null,
		origin?: Exclude<AxHighlightOrigin, null>,
	) => void;
	setSelectedKey: (key: string | null, origin?: "phone" | "tree") => void;
}

const AxSnapshotContext = createContext<AxSnapshotContextValue>({
	snapshot: null,
	status: "AX off",
	refreshing: false,
	refresh: async () => {},
	sourceEndpoint: undefined,
});
const AxSelectionContext = createContext<AxSelectionContextValue | null>(null);

export function useAxSnapshotContext() {
	return useContext(AxSnapshotContext);
}

export function useAxSelectionContext() {
	const context = useContext(AxSelectionContext);
	if (!context) throw new Error("AX selection context is unavailable");
	return context;
}

export function AccessibilityStateProvider({
	endpoint,
	refreshSignal,
	state,
	dispatch,
	children,
}: {
	endpoint?: string;
	refreshSignal?: number;
	state: AccessibilityInspectorState;
	dispatch: (event: AccessibilityInspectorEvent) => void;
	children: ReactNode;
}) {
	const snapshotValue = useAxSnapshot(
		state.open ? endpoint : undefined,
		refreshSignal,
	);
	const setHighlightedKey = useCallback(
		(key: string | null, origin?: Exclude<AxHighlightOrigin, null>) => {
			dispatch({ type: "TARGET_HOVERED", key, origin: origin ?? null });
		},
		[dispatch],
	);
	const setSelectedKey = useCallback(
		(key: string | null, origin: "phone" | "tree" = "tree") => {
			dispatch({ type: "TARGET_SELECTED", key, origin });
		},
		[dispatch],
	);
	const selectionValue = useMemo<AxSelectionContextValue>(
		() => ({
			highlightedKey: state.highlightedKey,
			highlightedOrigin: state.highlightedOrigin,
			selectedKey: state.selectedKey,
			setHighlightedKey,
			setSelectedKey,
		}),
		[
			setHighlightedKey,
			setSelectedKey,
			state.highlightedKey,
			state.highlightedOrigin,
			state.selectedKey,
		],
	);

	return (
		<AxSnapshotContext value={snapshotValue}>
			<AxSelectionContext value={selectionValue}>{children}</AxSelectionContext>
		</AxSnapshotContext>
	);
}
