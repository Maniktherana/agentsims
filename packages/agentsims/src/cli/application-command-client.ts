export type CommandClientOptions = {
	origin?: string;
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
