import type { LogTarget } from "../../core/tools/logs/contracts";
import { followConsole } from "./client";
import { ConsoleStore } from "./state";

type ReaderRequest = { target: LogTarget | null; active: boolean; basePath: string };

/** Serial replacement lets an old HTTP reader release its lease before a new target opens. */
export class ConsoleReader {
	private controller: AbortController | null = null;
	private key = "";
	private device: string | undefined;
	private revision = 0;
	private completion: Promise<void> = Promise.resolve();
	constructor(private readonly store: ConsoleStore, private readonly changed: () => void,
		private readonly fetcher?: typeof fetch) {}

	update(request: ReaderRequest): void {
		const key = request.active && request.target ? JSON.stringify([request.basePath, request.target]) : "";
		if (key === this.key) return;
		this.key = key;
		const revision = ++this.revision;
		this.controller?.abort();
		this.controller = null;
		if (this.device) this.store.connection(this.device, "closed");
		this.device = request.target?.device;
		this.changed();
		if (!key || !request.target) return;
		const target = request.target;
		this.store.session(target.device).statuses = [];
		this.store.connection(target.device, "connecting");
		this.changed();
		this.completion = this.completion.then(async () => {
			if (revision !== this.revision) return;
			const controller = new AbortController();
			this.controller = controller;
			await followConsole({ basePath: request.basePath, target, signal: controller.signal, fetch: this.fetcher,
				cursor: () => this.store.session(target.device).cursor,
				onRead: read => { this.store.read(target.device, read); this.changed(); },
				onEvent: event => { this.store.event(target.device, event); this.changed(); },
				onConnection: (state, error) => { this.store.connection(target.device, state, error); this.changed(); },
			});
		}).catch(error => {
			if (revision !== this.revision) return;
			this.store.connection(target.device, "error", error instanceof Error ? error.message : "The log connection failed.");
			this.changed();
		});
	}

	dispose(): Promise<void> {
		this.key = "";
		++this.revision;
		this.controller?.abort();
		this.controller = null;
		if (this.device) this.store.connection(this.device, "closed");
		return this.completion;
	}
}

/** Each visible device owns one reader; scope changes never use a synthetic device ID. */
export class ConsoleReaders {
	private readonly readers = new Map<string, ConsoleReader>();
	private requested = new Set<string>();
	constructor(private readonly store: ConsoleStore, private readonly changed: () => void,
		private readonly fetcher?: typeof fetch) {}
	update(request: { targets: readonly LogTarget[]; active: boolean; basePath: string }): void {
		this.requested = new Set(request.targets.map(target => target.device));
		let removed = false;
		for (const [device, reader] of this.readers) if (!this.requested.has(device)) {
			removed = true;
			void reader.dispose().then(() => { if (!this.requested.has(device) && this.readers.get(device) === reader) this.readers.delete(device); });
		}
		if (removed) this.changed();
		for (const target of request.targets) {
			let reader = this.readers.get(target.device);
			if (!reader && !request.active) continue;
			if (!reader) { reader = new ConsoleReader(this.store, this.changed, this.fetcher); this.readers.set(target.device, reader); }
			reader.update({ target, active: request.active, basePath: request.basePath });
		}
	}
	async dispose(): Promise<void> {
		this.requested.clear();
		await Promise.all([...this.readers].map(async ([device, reader]) => {
			await reader.dispose();
			if (!this.requested.has(device) && this.readers.get(device) === reader) this.readers.delete(device);
		}));
	}
}
