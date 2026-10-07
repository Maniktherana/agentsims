import type { ActionEffect, DeviceGoneDetails } from "../core/tools/errors";
import type { ActionOptions } from "../core/tools/actions";
import type { ContextInput } from "../core/tools/context/contracts";
import type {
	LogEvent,
	LogRead,
	LogTarget,
} from "../core/tools/logs/contracts";
import { logRequestParams } from "../core/tools/logs/target";
import { WORKSPACE_LIMITS } from "../core/tools/workspace/contracts";
import type { WorkspaceLease, WorkspaceConfiguration, WorkspaceInputReply, WorkspaceView } from "../core/tools/workspace/service";

export type WorkspaceVideoPacket = WorkspaceView & {
	leaseId: string; device: string; cursor: number; epoch: number; reset: boolean;
	mimeType: "application/x-agentsims-avcc" | "image/jpeg";
	bytes: Uint8Array; reservationId?: string;
};

function workspacePath(workspace: string, viewId?: string, leaseId?: string): string {
	return `/workspace/${encodeURIComponent(workspace)}${viewId === undefined ? "" : `/views/${encodeURIComponent(viewId)}`}${leaseId === undefined ? "" : `/leases/${encodeURIComponent(leaseId)}`}`;
}

export type CommandClientOptions = {
	origin?: string;
	timeoutMs?: number;
	signal?: AbortSignal;
};

/** A command that the server refused or lost reports how far the action got. */
export class CommandRequestError extends Error {
	readonly effect?: ActionEffect;
	readonly code?: string;
	readonly type?: string;
	readonly details?: DeviceGoneDetails;

	constructor(
		message: string,
		effect?: ActionEffect,
		code?: string,
		type?: string,
		details?: DeviceGoneDetails,
	) {
		super(message);
		this.name = "CommandRequestError";
		this.effect = effect;
		this.code = code;
		this.type = type;
		this.details = details;
	}
}

/** The action watch travels as query parameters, like the observe watch. */
function setWatchParams(
	query: URLSearchParams,
	watch: ActionOptions["watch"],
): void {
	if (!watch) return;
	query.set("watch", String(watch.durationMs));
	if (watch.samples !== undefined) query.set("samples", String(watch.samples));
	if (watch.everyMs !== undefined) query.set("every", String(watch.everyMs));
	if (watch.keepFrames) query.set("keepFrames", "1");
}

export type DeviceLogOptions = {
	limit?: number;
	level?: string;
	query?: string;
	package?: string;
	pid?: number;
};

const BYTES_KEY = "$agentsimsBytes";

function decodeWireValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(decodeWireValue);
	if (!value || typeof value !== "object") return value;
	const record = value as Record<string, unknown>;
	if (Object.keys(record).length === 1 && typeof record[BYTES_KEY] === "string")
		return Buffer.from(record[BYTES_KEY], "base64");
	return Object.fromEntries(
		Object.entries(record).map(([key, item]) => [key, decodeWireValue(item)]),
	);
}

function parseResponseText(text: string): unknown {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

export class ApplicationCommandClient {
	private readonly origin: string;
	private readonly timeoutMs: number;
	private readonly signal?: AbortSignal;

	constructor(options: CommandClientOptions = {}) {
		this.origin = (options.origin ?? "http://127.0.0.1:3200").replace(
			/\/$/,
			"",
		);
		this.timeoutMs = options.timeoutMs ?? 30_000;
		this.signal = options.signal;
	}

	async listDevices(): Promise<unknown> {
		return this.request("/grid/api");
	}

	async createWorkspace(): Promise<{ workspace: string }> { return this.request("/workspace", { method: "POST" }) as Promise<{ workspace: string }>; }
	async renewWorkspace(workspace: string): Promise<{ workspace: string }> { return this.request(workspacePath(workspace), { method: "PUT" }) as Promise<{ workspace: string }>; }
	async openWorkspaceView(workspace: string): Promise<WorkspaceView> { return this.request(`${workspacePath(workspace)}/views`, { method: "POST" }) as Promise<WorkspaceView>; }
	async openWorkspaceLease(workspace: string, viewId: string, device: string, codec: "avcc" | "jpeg" = "avcc"): Promise<WorkspaceLease> {
		return this.request(`${workspacePath(workspace, viewId)}/leases`, { method: "POST", body: JSON.stringify({ device, codec }) }) as Promise<WorkspaceLease>;
	}
	async workspaceLeaseConfig(workspace: string, viewId: string, leaseId: string): Promise<WorkspaceConfiguration> { return this.request(`${workspacePath(workspace, viewId, leaseId)}/config`) as Promise<WorkspaceConfiguration>; }
	async workspaceInput(workspace: string, viewId: string, batch: unknown): Promise<WorkspaceInputReply> {
		const leaseId = (batch as { leaseId?: unknown } | null)?.leaseId;
		if (typeof leaseId !== "string") throw new CommandRequestError("Workspace input requires its lease ID.");
		return this.request(`${workspacePath(workspace, viewId, leaseId)}/input`, { method: "POST", body: JSON.stringify(batch) }) as Promise<WorkspaceInputReply>;
	}
	async closeWorkspaceLease(workspace: string, viewId: string, leaseId: string): Promise<WorkspaceView & { leaseId: string; closed: true }> { return this.request(workspacePath(workspace, viewId, leaseId), { method: "DELETE" }) as Promise<WorkspaceView & { leaseId: string; closed: true }>; }
	async closeWorkspaceView(workspace: string, viewId: string): Promise<WorkspaceView & { closed: true }> { return this.request(workspacePath(workspace, viewId), { method: "DELETE" }) as Promise<WorkspaceView & { closed: true }>; }
	async closeWorkspace(workspace: string): Promise<{ workspace: string; closed: true }> { return this.request(workspacePath(workspace), { method: "DELETE" }) as Promise<{ workspace: string; closed: true }>; }
	async resizeWorkspaceReservation(workspace: string, viewId: string, reservationId: string, bytes: number): Promise<{ reservationId: string }> {
		return this.request(`${workspacePath(workspace)}/reservations/${encodeURIComponent(reservationId)}`, { method: "PUT", body: JSON.stringify({ viewId, bytes }) }) as Promise<{ reservationId: string }>;
	}
	async releaseWorkspaceReservation(workspace: string, reservationId: string): Promise<{ released: true }> {
		return this.request(`${workspacePath(workspace)}/reservations/${encodeURIComponent(reservationId)}`, { method: "DELETE" }) as Promise<{ released: true }>;
	}
	async readWorkspaceVideo(workspace: string, viewId: string, leaseId: string, options: { cursor?: number; epoch?: number; retain?: boolean } = {}): Promise<WorkspaceVideoPacket> {
		const query = new URLSearchParams();
		if (options.cursor !== undefined) query.set("cursor", String(options.cursor));
		if (options.epoch !== undefined) query.set("epoch", String(options.epoch));
		if (options.retain) query.set("retain", "1");
		const signal = AbortSignal.any([AbortSignal.timeout(this.timeoutMs), ...(this.signal ? [this.signal] : [])]);
		let reservationId: string | undefined;
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		try {
			const response = await fetch(`${this.origin}${workspacePath(workspace, viewId, leaseId)}/video?${query}`, { signal, redirect: "error" });
			reservationId = response.headers.get("X-Agentsims-Reservation") ?? undefined;
			if (!response.ok) {
				const value = await response.json() as { error?: string; code?: string };
				throw new CommandRequestError(value.error ?? "Workspace video is unavailable.", undefined, value.code, "WorkspaceError");
			}
			const maximum = WORKSPACE_LIMITS.accessUnitBytes + WORKSPACE_LIMITS.descriptionBytes + WORKSPACE_LIMITS.metadataBytes + 128;
			const length = Number(response.headers.get("Content-Length"));
			const cursor = Number(response.headers.get("X-Agentsims-Cursor")), epoch = Number(response.headers.get("X-Agentsims-Epoch"));
			const mimeType = response.headers.get("Content-Type"), reset = response.headers.get("X-Agentsims-Reset");
			if (response.headers.get("X-Agentsims-Workspace") !== workspace || response.headers.get("X-Agentsims-View") !== viewId || response.headers.get("X-Agentsims-Lease") !== leaseId ||
				!response.body || !Number.isSafeInteger(length) || length < 1 || length > maximum || !Number.isSafeInteger(cursor) || cursor < 1 || !Number.isSafeInteger(epoch) || epoch < 1 ||
				(mimeType !== "application/x-agentsims-avcc" && mimeType !== "image/jpeg") || (reset !== "0" && reset !== "1") ||
				(options.retain && (!reservationId || !/^[0-9a-f-]{36}$/i.test(reservationId))))
				throw new CommandRequestError("The runtime returned invalid workspace video metadata.");
			const device = decodeURIComponent(response.headers.get("X-Agentsims-Device") ?? "");
			if (!device || device.length > 256) throw new CommandRequestError("The runtime returned an invalid workspace video device.");
			reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			for (;;) {
				const next = await reader.read(); if (next.done) break;
				size += next.value.length;
				if (size > length) throw new CommandRequestError("The runtime returned oversized workspace video.");
				chunks.push(next.value);
			}
			if (size !== length) throw new CommandRequestError("The runtime returned incomplete workspace video.");
			return { workspace, viewId, leaseId, device, cursor, epoch, reset: reset === "1", mimeType, bytes: Buffer.concat(chunks, size), ...(reservationId ? { reservationId } : {}) };
		} catch (error) {
			if (reservationId) await new ApplicationCommandClient({ origin: this.origin, timeoutMs: 5000 }).releaseWorkspaceReservation(workspace, reservationId).catch(() => {});
			throw error;
		} finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); }
	}

	async appLogs(target: LogTarget, query: unknown): Promise<LogRead> {
		return this.request(
			`/logs/snapshot?${logRequestParams(target, query)}`,
		) as Promise<LogRead>;
	}

	async *streamAppLogs(
		target: LogTarget,
		query: unknown,
		signal?: AbortSignal,
	): AsyncIterable<LogEvent> {
		const controller = new AbortController();
		const signals = [this.signal, signal].filter(
			(value): value is AbortSignal => value !== undefined,
		);
		const cancel = () => controller.abort();
		for (const value of signals) {
			if (value.aborted) cancel();
			else value.addEventListener("abort", cancel, { once: true });
		}
		let timedOut = false;
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, this.timeoutMs);
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		try {
			const response = await fetch(
				`${this.origin}/logs?${logRequestParams(target, query)}`,
				{ signal: controller.signal, headers: { Accept: "text/event-stream" } },
			);
			if (!response.ok) {
				const value = parseResponseText(await response.text()) as {
					error?: unknown;
					code?: string;
					type?: string;
				} | null;
				throw new CommandRequestError(
					String(
						value?.error ?? `Request failed with status ${response.status}`,
					),
					undefined,
					value?.code,
					value?.type,
				);
			}
			if (
				!response.headers
					.get("content-type")
					?.startsWith("text/event-stream") ||
				!response.body
			)
				throw new CommandRequestError(
					"The runtime did not return an application log stream.",
				);
			clearTimeout(timeout);
			reader = response.body.getReader();
			const decoder = new TextDecoder();
			let pending = "";
			for (;;) {
				const { value, done } = await reader.read();
				pending += decoder.decode(value, { stream: !done });
				if (pending.length > 8 * 1024 * 1024)
					throw new CommandRequestError(
						"The application log event exceeds 8 MiB.",
					);
				let boundary: RegExpExecArray | null;
				while ((boundary = /\r?\n\r?\n/.exec(pending))) {
					const block = pending.slice(0, boundary.index);
					pending = pending.slice(boundary.index + boundary[0].length);
					const data = block
						.split(/\r?\n/)
						.filter((line) => line.startsWith("data:"))
						.map((line) => line.slice(5).replace(/^ /, ""))
						.join("\n");
					if (!data) continue;
					let event: unknown;
					try {
						event = JSON.parse(data);
					} catch {
						throw new CommandRequestError(
							"The runtime returned an invalid application log event.",
						);
					}
					if (
						block
							.split(/\r?\n/)
							.some((line) => /^event:\s*failure\s*$/.test(line))
					) {
						const failed = event as {
							error?: unknown;
							code?: string;
							type?: string;
						} | null;
						throw new CommandRequestError(
							String(failed?.error ?? "The application log stream failed."),
							undefined,
							failed?.code,
							failed?.type,
						);
					}
					if (!event || typeof event !== "object" || !("type" in event))
						throw new CommandRequestError(
							"The runtime returned an invalid application log event.",
						);
					if (event.type === "error") {
						const failed = event as { error?: unknown; code?: string };
						throw new CommandRequestError(
							String(failed.error ?? "The application log stream failed."),
							undefined,
							failed.code,
						);
					}
					if (
						event.type !== "records" &&
						event.type !== "status" &&
						event.type !== "reset"
					)
						throw new CommandRequestError(
							"The runtime returned an unknown application log event.",
						);
					yield event as LogEvent;
				}
				if (done) {
					if (pending.split(/\r?\n/).some((line) => line.startsWith("data:")))
						throw new CommandRequestError(
							"The application log stream ended during an event.",
						);
					break;
				}
			}
		} catch (error) {
			if (timedOut)
				throw new CommandRequestError(
					`The request timed out after ${this.timeoutMs} ms.`,
				);
			if (controller.signal.aborted) return;
			if (error instanceof CommandRequestError) throw error;
			throw new CommandRequestError(
				`Cannot read application logs from ${this.origin}. ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			clearTimeout(timeout);
			controller.abort();
			try {
				await reader?.cancel();
			} catch {
				/* The aborted response may already be closed. */
			}
			reader?.releaseLock();
			for (const value of signals) value.removeEventListener("abort", cancel);
		}
	}

	async listContext(workspace: string, device?: string): Promise<unknown> {
		const query = new URLSearchParams({ workspace });
		if (device) query.set("device", device);
		return this.request(`/context?${query}`);
	}

	async readContext(workspace: string, id: string): Promise<unknown> {
		return this.request(
			`/context/${encodeURIComponent(id)}?${new URLSearchParams({ workspace })}`,
		);
	}

	async createContext(
		workspace: string,
		input: ContextInput,
		requestId?: string,
	): Promise<unknown> {
		return this.request("/context", {
			method: "POST",
			body: JSON.stringify({ workspace, input, requestId }),
		});
	}

	async updateContext(
		workspace: string,
		id: string,
		note: string,
	): Promise<unknown> {
		return this.request(`/context/${encodeURIComponent(id)}`, {
			method: "PATCH",
			body: JSON.stringify({ workspace, note }),
		});
	}

	async saveContext(workspace: string, id: string): Promise<unknown> {
		return this.request(`/context/${encodeURIComponent(id)}/save`, {
			method: "POST",
			body: JSON.stringify({ workspace }),
		});
	}

	async removeContext(workspace: string, id: string): Promise<unknown> {
		return this.request(
			`/context/${encodeURIComponent(id)}?${new URLSearchParams({ workspace })}`,
			{ method: "DELETE" },
		);
	}

	async exportContext(
		workspace: string,
		ids: readonly string[],
	): Promise<unknown> {
		return this.request("/context/export", {
			method: "POST",
			body: JSON.stringify({ workspace, ids }),
		});
	}

	async startDevice(deviceId: string): Promise<unknown> {
		return this.request("/grid/api/start", {
			method: "POST",
			body: JSON.stringify({ udid: deviceId }),
		});
	}

	async shutdownDevice(deviceId: string): Promise<unknown> {
		return this.request("/grid/api/shutdown", {
			method: "POST",
			body: JSON.stringify({ udid: deviceId }),
		});
	}

	async media(deviceId: string): Promise<unknown> {
		return this.request(`/media?device=${encodeURIComponent(deviceId)}`);
	}

	async applyMedia(deviceId: string, action: unknown): Promise<unknown> {
		return this.request(`/media?device=${encodeURIComponent(deviceId)}`, {
			method: "POST",
			body: JSON.stringify(action),
		});
	}

	async listWebcams(deviceId: string): Promise<unknown> {
		return this.request(
			`/media/camera/webcams?device=${encodeURIComponent(deviceId)}`,
		);
	}

	async selectWebcam(
		deviceId: string,
		webcamId: string,
		face?: "front" | "back",
	): Promise<unknown> {
		const android = deviceId.startsWith("android:");
		return this.request(
			`/media/camera/webcam?device=${encodeURIComponent(deviceId)}`,
			{
				method: "POST",
				body: JSON.stringify(
					android
						? { platform: "android", face, webcamId }
						: { platform: "ios", webcamId },
				),
			},
		);
	}

	async stopCamera(deviceId: string): Promise<unknown> {
		return this.request(
			`/media/camera/stop?device=${encodeURIComponent(deviceId)}`,
			{ method: "POST", body: "{}" },
		);
	}

	async status(): Promise<unknown> {
		return this.request("/status");
	}

	async observeDevice(
		deviceId: string,
		options: { all?: boolean } = {},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.all) query.set("all", "1");
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/observe${search}`,
		);
	}

	async screenshotDevice(deviceId: string): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/screenshot`);
	}

	async watchDevice(
		deviceId: string,
		options: {
			durationMs: number;
			samples?: number;
			everyMs?: number;
			keepFrames?: boolean;
		},
	): Promise<unknown> {
		const query = new URLSearchParams({ watch: String(options.durationMs) });
		if (options.samples !== undefined)
			query.set("samples", String(options.samples));
		if (options.everyMs !== undefined)
			query.set("every", String(options.everyMs));
		if (options.keepFrames) query.set("keepFrames", "1");
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/watch?${query}`,
		);
	}

	async waitDevice(
		deviceId: string,
		options: {
			for?: string;
			gone?: string;
			stable?: boolean;
			timeoutMs?: number;
			intervalMs?: number;
		},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.for !== undefined) query.set("for", options.for);
		if (options.gone !== undefined) query.set("gone", options.gone);
		if (options.stable) query.set("stable", "1");
		if (options.timeoutMs !== undefined)
			query.set("timeout", String(options.timeoutMs));
		if (options.intervalMs !== undefined)
			query.set("interval", String(options.intervalMs));
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/wait?${query}`,
		);
	}

	async startRecording(
		deviceId: string,
		options: { out?: string } = {},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.out !== undefined) query.set("out", options.out);
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/recording/start${search}`,
			{ method: "POST" },
		);
	}

	async stopRecording(deviceId: string): Promise<unknown> {
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/recording/stop`,
			{ method: "POST" },
		);
	}

	async recordingStatus(deviceId: string): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/recording`);
	}

	async findOnDevice(deviceId: string, query: string): Promise<unknown> {
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/find?q=${encodeURIComponent(query)}`,
		);
	}

	async actDevice(
		deviceId: string,
		actions: ReadonlyArray<unknown>,
		options: ActionOptions = {},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.screenshot) query.set("screenshot", "1");
		setWatchParams(query, options.watch);
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/act${search}`,
			{ method: "POST", body: JSON.stringify({ actions }) },
			"unknown",
		);
	}

	/** A sequence re-observes between steps, so it needs a longer budget. */
	async runSequence(
		deviceId: string,
		steps: ReadonlyArray<unknown>,
		options: ActionOptions = {},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.screenshot) query.set("screenshot", "1");
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/run${search}`,
			{ method: "POST", body: JSON.stringify({ steps }) },
			"unknown",
			this.timeoutMs + steps.length * 10_000,
		);
	}

	async scrollDevice(deviceId: string, request: unknown): Promise<unknown> {
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/scroll`,
			{ method: "POST", body: JSON.stringify(request) },
			"unknown",
		);
	}

	async app(
		deviceId: string,
		operation: string,
		value?: string,
		options: ActionOptions = {},
	): Promise<unknown> {
		const query = new URLSearchParams();
		if (options.screenshot) query.set("screenshot", "1");
		setWatchParams(query, options.watch);
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/app${search}`,
			{
				method: "POST",
				body: JSON.stringify({
					operation,
					...(value === undefined ? {} : { value }),
				}),
			},
			operation === "launch" || operation === "stop" ? "unknown" : undefined,
		);
	}

	async listPermissions(deviceId: string, bundleId: string): Promise<unknown> {
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/permissions?bundleId=${encodeURIComponent(bundleId)}`,
		);
	}

	async mutatePermissions(deviceId: string, input: unknown): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/permissions`, {
			method: "POST",
			body: JSON.stringify(input),
		});
	}

	async deviceLogs(
		deviceId: string,
		options: DeviceLogOptions = {},
	): Promise<unknown> {
		const query = new URLSearchParams({ device: deviceId });
		if (options.limit !== undefined) query.set("limit", String(options.limit));
		if (options.level) query.set("level", options.level);
		if (options.query) query.set("query", options.query);
		if (options.package) query.set("package", options.package);
		if (options.pid !== undefined) query.set("pid", String(options.pid));
		return this.request(`/android/logs/snapshot?${query}`);
	}

	async android(
		device: string,
		endpoint: string,
		init?: RequestInit,
	): Promise<unknown> {
		return this.request(
			`/android/${endpoint}?device=${encodeURIComponent(device)}`,
			init,
		);
	}

	async startTrace(deviceId: string, name?: string): Promise<unknown> {
		const query = new URLSearchParams();
		if (name !== undefined) query.set("name", name);
		const search = query.size > 0 ? `?${query}` : "";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/trace/start${search}`,
			{ method: "POST", body: "{}" },
		);
	}

	async stopTrace(deviceId: string): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/trace/stop`, {
			method: "POST",
			body: "{}",
		});
	}

	async traceStatus(deviceId: string): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/trace`);
	}

	private async request(
		path: string,
		init?: RequestInit,
		uncertainEffect?: ActionEffect,
		timeoutMs = this.timeoutMs,
	): Promise<unknown> {
		const signals = [this.signal, init?.signal].filter(
			(signal): signal is AbortSignal => signal !== undefined,
		);
		const controller = new AbortController();
		let timedOut = false;
		const cancel = () => controller.abort();
		for (const signal of signals) {
			if (signal.aborted) cancel();
			else signal.addEventListener("abort", cancel, { once: true });
		}
		const timeout = setTimeout(() => {
			timedOut = true;
			controller.abort();
		}, timeoutMs);
		let response: Response;
		let text: string;
		try {
			response = await fetch(`${this.origin}${path}`, {
				...init,
				signal: controller.signal,
				headers: {
					"Content-Type": "application/json",
					...init?.headers,
				},
			});
			text = await response.text();
		} catch (error) {
			const message = timedOut
				? `The request timed out after ${timeoutMs} ms.`
				: controller.signal.aborted
					? "The request was canceled."
					: `Cannot connect to ${this.origin}. Start Agentsims before you run this command. ${
							error instanceof Error ? error.message : String(error)
						}`;
			throw new CommandRequestError(message, uncertainEffect);
		} finally {
			clearTimeout(timeout);
			for (const signal of signals) signal.removeEventListener("abort", cancel);
		}
		const value = parseResponseText(text);
		if (!response.ok) {
			const body = (value ?? {}) as {
				error?: unknown;
				effect?: ActionEffect;
				code?: string;
				type?: string;
				details?: DeviceGoneDetails;
			};
			throw new CommandRequestError(
				body.error === undefined
					? text || `Request failed with status ${response.status}`
					: String(body.error),
				body.effect,
				body.code,
				body.type,
				body.details,
			);
		}
		return decodeWireValue(value);
	}
}
