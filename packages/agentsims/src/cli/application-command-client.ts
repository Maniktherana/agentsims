import type {
	ActionEffect,
	DeviceGoneDetails,
} from "../core/tools/errors";
import type { ActionOptions } from "../core/tools/actions";

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
	if (watch.region !== undefined)
		query.set(
			"region",
			typeof watch.region === "string"
				? watch.region
				: `${watch.region.x},${watch.region.y},${watch.region.width},${watch.region.height}`,
		);
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
	if (
		Object.keys(record).length === 1 &&
		typeof record[BYTES_KEY] === "string"
	)
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
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/screenshot`,
		);
	}

	async watchDevice(
		deviceId: string,
		options: {
			durationMs: number;
			samples?: number;
			everyMs?: number;
			region?: string;
			keepFrames?: boolean;
		},
	): Promise<unknown> {
		const query = new URLSearchParams({ watch: String(options.durationMs) });
		if (options.samples !== undefined)
			query.set("samples", String(options.samples));
		if (options.everyMs !== undefined)
			query.set("every", String(options.everyMs));
		if (options.region !== undefined) query.set("region", options.region);
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
			throw new CommandRequestError(
				message,
				uncertainEffect,
			);
		} finally {
			clearTimeout(timeout);
			for (const signal of signals)
				signal.removeEventListener("abort", cancel);
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
