import { useEffect, useState } from "react";
import type { AnnotationIdentity } from "../../annotation/contracts";
import type { AnnotationNativePreview } from "../../annotation/live-contracts";
import {
	axRefreshEndpoint,
	decodeAxSnapshotEvent,
} from "../../components/accessibility/provider";
import { openHostEventStream } from "../../simulator/input/exec";

export interface NativeAnnotationPreviewOptions {
	endpoint?: string;
	identity: AnnotationIdentity;
	active: boolean;
	connected: boolean;
}

/** Bare native data is preview evidence, never a source-aware or fresh cache. */
export function useNativeAnnotationPreview({
	endpoint,
	identity,
	active,
	connected,
}: NativeAnnotationPreviewOptions): AnnotationNativePreview {
	const identityKey = JSON.stringify(identity);
	const [preview, setPreview] = useState<AnnotationNativePreview | null>(null);
	useEffect(() => {
		const boundIdentity = { ...identity };
		const waiting: AnnotationNativePreview = {
			identity: boundIdentity,
			snapshot: null,
			status: "AX waiting",
			connected: active && connected,
		};
		setPreview(waiting);
		if (!active || !connected || !endpoint) return;
		let disposed = false;
		let previousPayload: string | null = null;
		let source: ReturnType<typeof openHostEventStream> | null = null;
		const abort = new AbortController();
		const disconnect = () => {
			source?.close();
			source = null;
			previousPayload = null;
			if (!disposed) setPreview({ ...waiting, connected: false });
		};
		const connect = () => {
			if (disposed || source || document.hidden) return;
			const reader = openHostEventStream(endpoint);
			source = reader;
			reader.onmessage = (event) => {
				if (disposed || source !== reader) return;
				try {
					const decoded = decodeAxSnapshotEvent(event.data, previousPayload);
					if (!decoded) return;
					previousPayload = decoded.payload;
					setPreview({
						identity: boundIdentity,
						snapshot: decoded.snapshot,
						status: decoded.status,
						connected: true,
					});
				} catch {
					setPreview({ ...waiting, snapshot: null, status: "AX parse error" });
				}
			};
			reader.onerror = () => {
				if (disposed || source !== reader) return;
				setPreview({ ...waiting, status: "AX reconnecting", connected: false });
				previousPayload = null;
			};
		};
		const onVisibility = () => (document.hidden ? disconnect() : connect());
		connect();
		void fetch(axRefreshEndpoint(endpoint), {
			method: "POST",
			signal: abort.signal,
		})
			.then((response) => {
				if (!response.ok)
					throw new Error(`AX refresh failed (${response.status})`);
			})
			.catch((error) => {
				if (disposed || abort.signal.aborted) return;
				setPreview((current) =>
					current?.snapshot
						? current
						: {
								...waiting,
								status:
									error instanceof Error ? error.message : "AX refresh failed",
							},
				);
			});
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			disposed = true;
			abort.abort();
			disconnect();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [endpoint, identityKey, active, connected]);
	return active &&
		connected &&
		preview &&
		JSON.stringify(preview.identity) === identityKey
		? preview
		: {
				identity,
				snapshot: null,
				status: active ? "AX waiting" : "AX off",
				connected: false,
			};
}
