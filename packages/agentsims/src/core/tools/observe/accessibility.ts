import { Context, Effect, Layer } from "effect";
import { logRuntime } from "../../logging";
import { AX_UNAVAILABLE_ERROR } from "./accessibility-model";
import type { AxSnapshot } from "./accessibility-model";
import { androidSerialFromStateId } from "../../android/device/identifiers";
import { collectAndroidAxSnapshot } from "../../android/accessibility/snapshot";
import { subscribeAndroidAxChanges } from "../../android/accessibility/ax-server";
import { AndroidAxServers } from "../../android/accessibility/ax-server";
import { AndroidSessions } from "../../android/session/session";
import { iosAxSnapshot } from "../../ios/accessibility";
import { axDescribeAsync } from "../../ios/stream/native";
import { enrichAxSnapshotWithRnSource } from "../../react-native/enrich-accessibility";

export type { AxElement, AxRect, AxSnapshot } from "./accessibility-model";

const POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 2000;
const ANDROID_POLL_INTERVAL_MS = 5000;
const ANDROID_MAX_POLL_INTERVAL_MS = 10_000;
const UNAVAILABLE_RETRY_INTERVAL_MS = 15_000;
// The first native invalidation captures immediately. Further invalidations
// share one pending capture at this cadence so AX remains live without taking
// a full UIAutomator traversal for every animation frame.
const ANDROID_CHANGE_MIN_INTERVAL_MS = 100;

async function snapshotFromNative(udid: string): Promise<AxSnapshot> {
	let raw: unknown;
	try {
		raw = JSON.parse(await axDescribeAsync(udid));
	} catch {
		// The in-process AX bridge throws when the simulator can't satisfy
		// accessibility right now (framework missing, SpringBoard restarting,
		// etc). Surface as the standard "unavailable" error so the streamer backs
		// off and recovers automatically.
		return {
			screen: { width: 1, height: 1 },
			elements: [],
			errors: [AX_UNAVAILABLE_ERROR],
		};
	}
	return iosAxSnapshot(raw);
}

function isAxUnavailableSnapshot(snapshot: AxSnapshot | null) {
	return snapshot?.errors?.includes(AX_UNAVAILABLE_ERROR) ?? false;
}

function isUsableAxSnapshot(snapshot: AxSnapshot) {
	return (
		snapshot.elements.length > 0 &&
		snapshot.screen.width > 1 &&
		snapshot.screen.height > 1
	);
}

async function collectAxSnapshot(udid: string): Promise<AxSnapshot> {
	const androidSerial = androidSerialFromStateId(udid);
	if (androidSerial) {
		return enrichAxSnapshotWithRnSource(
			await collectAndroidAxSnapshot(androidSerial, { mode: "fresh" }),
		);
	}

	const errors: string[] = [];

	try {
		const snapshot = await snapshotFromNative(udid);
		if (snapshot.errors?.length) return snapshot;
		if (!isUsableAxSnapshot(snapshot)) {
			throw new Error(
				`native AX returned ${snapshot.elements.length} elements in ${snapshot.screen.width}x${snapshot.screen.height} AX space`,
			);
		}
		return enrichAxSnapshotWithRnSource({
			...snapshot,
			errors,
		});
	} catch (error) {
		errors.push((error as Error).message || String(error));
	}

	return {
		screen: { width: 1, height: 1 },
		elements: [],
		errors,
	};
}

interface AxStreamer {
	addClient(onSnapshot: (snapshot: AxSnapshot) => void): () => void;
	hasClients(): boolean;
	refresh(): void;
	dispose(): void;
}

export interface AxStreamerCacheOptions {
	collect?: (udid: string) => Promise<AxSnapshot>;
	now?: () => number;
	androidPollIntervalMs?: number;
	androidChangeMinIntervalMs?: number;
	setTimer?: (
		callback: () => void,
		delayMs: number,
	) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	subscribeAndroidChanges?: (
		serial: string,
		listener: () => void,
	) => () => void;
}

function createAxStreamer({
	udid,
	collect = collectAxSnapshot,
	now = Date.now,
	androidPollIntervalMs = ANDROID_POLL_INTERVAL_MS,
	androidChangeMinIntervalMs = ANDROID_CHANGE_MIN_INTERVAL_MS,
	setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
	clearTimer = (timer) => clearTimeout(timer),
	subscribeAndroidChanges = subscribeAndroidAxChanges,
}: {
	udid: string;
} & AxStreamerCacheOptions): AxStreamer {
	const clients = new Set<(snapshot: AxSnapshot) => void>();
	const androidSerial = androidSerialFromStateId(udid);
	const android = androidSerial !== null;
	const basePollIntervalMs = android ? androidPollIntervalMs : POLL_INTERVAL_MS;
	const maxPollIntervalMs = android
		? ANDROID_MAX_POLL_INTERVAL_MS
		: MAX_POLL_INTERVAL_MS;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let androidChangeTimer: ReturnType<typeof setTimeout> | null = null;
	let latestSnapshot: AxSnapshot | null = null;
	let latestSnapshotKey: string | null = null;
	let latestCollectedAt = 0;
	let latestUsable = false;
	let reportedStatus: string | null = null;
	let retryNotBefore = 0;
	let pollIntervalMs = basePollIntervalMs;
	let polling = false;
	let lastAndroidCaptureStartedAt: number | null = null;
	let forceMessagePending = false;
	let changeCapturePending = false;
	let explicitRefreshPending = false;
	let latestDirty = false;
	let disposed = false;
	let unsubscribeAndroidChanges = () => {};

	const schedule = (delayMs = pollIntervalMs) => {
		if (disposed || clients.size === 0 || timer) return;
		timer = setTimer(poll, delayMs);
	};

	const scheduleAndroidChangeCapture = () => {
		if (disposed || clients.size === 0 || androidChangeTimer) return;
		const cadenceDelay =
			lastAndroidCaptureStartedAt === null
				? 0
				: Math.max(
						0,
						androidChangeMinIntervalMs - (now() - lastAndroidCaptureStartedAt),
					);
		// A failing or empty capture enters the unavailable backoff. Native
		// invalidations can continue while UiAutomation is unhealthy; do not let
		// those events bypass the backoff and start repeated expensive captures.
		const intervalDelay = Math.max(
			cadenceDelay,
			Math.max(0, retryNotBefore - now()),
		);
		if (intervalDelay === 0) {
			captureAndroidChange();
			return;
		}
		androidChangeTimer = setTimer(captureAndroidChange, intervalDelay);
	};

	const poll = async (forceMessage = false) => {
		timer = null;
		if (disposed || polling || clients.size === 0) {
			return;
		}

		polling = true;
		if (android) lastAndroidCaptureStartedAt = now();
		latestDirty = false;
		let retry = true;
		try {
			const next = await collect(udid);
			const status = isUsableAxSnapshot(next)
				? "ready"
				: next.errors?.join("; ") || "No accessibility elements returned";
			if (status !== reportedStatus) {
				logRuntime(
					`${udid}:ax`,
					status === "ready"
						? `Ready (${next.elements.length} elements).`
						: `Unavailable: ${status}. Retrying.`,
				);
				reportedStatus = status;
			}
			const nextSnapshotKey = JSON.stringify(next);
			if (forceMessage || nextSnapshotKey !== latestSnapshotKey) {
				for (const client of clients) client(next);
			}
			if (nextSnapshotKey !== latestSnapshotKey) {
				pollIntervalMs = basePollIntervalMs;
			} else {
				pollIntervalMs = Math.min(pollIntervalMs * 2, maxPollIntervalMs);
			}
			latestSnapshot = next;
			latestSnapshotKey = nextSnapshotKey;
			latestCollectedAt = now();
			latestUsable = isUsableAxSnapshot(next);
			// If the helper says AX is unavailable (framework missing, sim
			// booting), keep polling but back off so we recover automatically
			// without spamming requests.
			if (isAxUnavailableSnapshot(next) || !latestUsable) {
				pollIntervalMs = UNAVAILABLE_RETRY_INTERVAL_MS;
				retryNotBefore = latestCollectedAt + UNAVAILABLE_RETRY_INTERVAL_MS;
				retry = true;
			} else {
				retryNotBefore = 0;
			}
		} finally {
			polling = false;
			if (
				(explicitRefreshPending || changeCapturePending) &&
				!disposed &&
				clients.size > 0
			) {
				// Browser refreshes and native changes share one serialized trailing
				// capture at the bounded cadence. Whichever source starts it consumes
				// the pending state from both sources.
				scheduleAndroidChangeCapture();
			} else if (retry && (!android || !latestUsable)) {
				// Android review is event-driven once a usable snapshot exists. Keep
				// periodic polling only for iOS and unavailable-result recovery.
				schedule();
			}
		}
	};

	const captureAndroidChange = () => {
		androidChangeTimer = null;
		if (disposed || clients.size === 0) return;
		if (polling) {
			return;
		}
		if (!changeCapturePending && !explicitRefreshPending) return;
		const forceMessage = forceMessagePending;
		forceMessagePending = false;
		changeCapturePending = false;
		explicitRefreshPending = false;
		void poll(forceMessage);
	};

	const onAndroidChange = () => {
		if (disposed) return;
		latestDirty = true;
		if (clients.size === 0) return;
		changeCapturePending = true;
		if (polling) return;
		scheduleAndroidChangeCapture();
	};

	if (androidSerial) {
		unsubscribeAndroidChanges = subscribeAndroidChanges(
			androidSerial,
			onAndroidChange,
		);
	}

	return {
		addClient(onSnapshot) {
			if (disposed) return () => {};
			if (clients.size === 0) logRuntime(`${udid}:ax`, "Subscribed.");
			clients.add(onSnapshot);
			if (latestSnapshot) onSnapshot(latestSnapshot);
			if (!latestSnapshot) {
				void poll();
			} else if (android && latestDirty) {
				if (androidChangeTimer) {
					clearTimer(androidChangeTimer);
					androidChangeTimer = null;
				}
				changeCapturePending = true;
				scheduleAndroidChangeCapture();
			} else if (!latestUsable) {
				const retryDelay = Math.max(0, retryNotBefore - now());
				if (retryDelay === 0) void poll();
				else schedule(retryDelay);
			} else if (!android) {
				schedule(Math.max(0, basePollIntervalMs - (now() - latestCollectedAt)));
			}
			return () => {
				clients.delete(onSnapshot);
				if (clients.size === 0 && timer) {
					clearTimer(timer);
					timer = null;
				}
				if (clients.size === 0 && androidChangeTimer) {
					clearTimer(androidChangeTimer);
					androidChangeTimer = null;
				}
				if (clients.size === 0) {
					logRuntime(`${udid}:ax`, "Unsubscribed. Snapshot collection paused.");
					forceMessagePending = false;
					changeCapturePending = false;
					explicitRefreshPending = false;
					latestDirty = false;
				}
			};
		},
		hasClients() {
			return clients.size > 0;
		},
		refresh() {
			if (disposed || clients.size === 0) return;
			latestDirty = false;
			retryNotBefore = 0;
			pollIntervalMs = basePollIntervalMs;
			if (timer) {
				clearTimer(timer);
				timer = null;
			}
			// Explicit interaction completion and native invalidation share the same
			// pending capture. This caps repeated POST refreshes without losing the
			// final state, and still confirms an identical forced result over SSE.
			explicitRefreshPending = true;
			forceMessagePending = true;
			if (!polling) scheduleAndroidChangeCapture();
		},
		dispose() {
			if (disposed) return;
			logRuntime(`${udid}:ax`, "Closed.");
			disposed = true;
			if (timer) {
				clearTimer(timer);
				timer = null;
			}
			if (androidChangeTimer) {
				clearTimer(androidChangeTimer);
				androidChangeTimer = null;
			}
			unsubscribeAndroidChanges();
			unsubscribeAndroidChanges = () => {};
			clients.clear();
			latestSnapshot = null;
			latestSnapshotKey = null;
			forceMessagePending = false;
			changeCapturePending = false;
			latestDirty = false;
			explicitRefreshPending = false;
		},
	};
}

export interface AxStreamerCache {
	get(udid: string): AxStreamer;
	refreshActive(udid: string): boolean;
	prune(activeUdids: Iterable<string>): void;
	size(): number;
	dispose(): void;
}

export function createAxStreamerCache(
	options: AxStreamerCacheOptions = {},
): AxStreamerCache {
	const streamers = new Map<string, AxStreamer>();

	return {
		/**
		 * Get (or create) the accessibility-snapshot streamer for a simulator.
		 * Snapshots come from the in-process native AX bridge keyed by udid.
		 */
		get(udid: string) {
			const existing = streamers.get(udid);
			if (existing) return existing;

			const streamer = createAxStreamer({ udid, ...options });
			streamers.set(udid, streamer);
			return streamer;
		},
		/**
		 * Refresh an already-validated stream only while its SSE client is live.
		 * This never creates an entry, so arbitrary request keys still require
		 * device discovery before they can enter the cache.
		 */
		refreshActive(udid) {
			const streamer = streamers.get(udid);
			if (!streamer?.hasClients()) return false;
			streamer.refresh();
			return true;
		},
		/**
		 * Drop streamers for simulators no longer present in `activeUdids`.
		 * Without this, the cache grew append-only across a server's lifetime
		 * as devices were booted/erased/reset, each entry holding a poll
		 * timer, last-snapshot buffer, and SSE client set.
		 */
		prune(activeUdids) {
			const active =
				activeUdids instanceof Set ? activeUdids : new Set(activeUdids);
			for (const [udid, streamer] of streamers) {
				if (!active.has(udid)) {
					streamer.dispose();
					streamers.delete(udid);
				}
			}
		},
		size() {
			return streamers.size;
		},
		dispose() {
			for (const streamer of streamers.values()) streamer.dispose();
			streamers.clear();
		},
	};
}

export class AxStreamers extends Context.Tag("@agentsims/AxStreamers")<
	AxStreamers,
	AxStreamerCache
>() {}

export const AxStreamersLive = Layer.scoped(
	AxStreamers,
	Effect.gen(function* () {
		const axServers = yield* AndroidAxServers;
		const androidSessions = yield* AndroidSessions;
		const cache = createAxStreamerCache({
			collect: async (udid) => {
				const serial = androidSerialFromStateId(udid);
				if (!serial) return collectAxSnapshot(udid);
				const session = await Effect.runPromise(androidSessions.get(serial));
				const { width, height } = await session.readConfig();
				return collectAndroidAxSnapshot(serial, {
					screen: { width, height },
					readFastXml: (target, mode) =>
						Effect.runPromise(axServers.read(target, mode)),
				});
			},
		});
		return yield* Effect.acquireRelease(Effect.succeed(cache), (value) =>
			Effect.sync(() => value.dispose()),
		);
	}),
);
