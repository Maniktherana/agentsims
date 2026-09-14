export type CommandClientOptions = {
	origin?: string;
};

export type DeviceLogOptions = {
	limit?: number;
	level?: string;
	query?: string;
	package?: string;
	pid?: number;
};

export class ApplicationCommandClient {
	private readonly origin: string;

	constructor(options: CommandClientOptions = {}) {
		this.origin = (options.origin ?? "http://127.0.0.1:3200").replace(
			/\/$/,
			"",
		);
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
		includeAccessibility = true,
	): Promise<unknown> {
		const query = includeAccessibility ? "" : "?ax=0";
		return this.request(
			`/device/${encodeURIComponent(deviceId)}/observe${query}`,
		);
	}

	async actDevice(
		deviceId: string,
		actions: ReadonlyArray<unknown>,
	): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/act`, {
			method: "POST",
			body: JSON.stringify({ actions }),
		});
	}

	async app(
		deviceId: string,
		operation: string,
		value?: string,
	): Promise<unknown> {
		return this.request(`/device/${encodeURIComponent(deviceId)}/app`, {
			method: "POST",
			body: JSON.stringify({
				operation,
				...(value === undefined ? {} : { value }),
			}),
		});
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

	private async request(path: string, init?: RequestInit): Promise<unknown> {
		let response: Response;
		try {
			response = await fetch(`${this.origin}${path}`, {
				...init,
				headers: {
					"Content-Type": "application/json",
					...init?.headers,
				},
			});
		} catch (error) {
			throw new Error(
				`Cannot connect to ${this.origin}. Start Agentsims before you run this command. ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		const text = await response.text();
		let value: unknown = text;
		try {
			value = text ? JSON.parse(text) : null;
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
		if (!response.ok) {
			const message =
				value && typeof value === "object" && "error" in value
					? String((value as { error: unknown }).error)
					: text || `Request failed with status ${response.status}`;
			throw new Error(message);
		}
		return value;
	}
}
