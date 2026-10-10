import { randomUUID } from "node:crypto";
import { Context, Layer } from "effect";

/** Holder of each device: the browser tab that the user works in. */
export type ViewerHolders = Readonly<Record<string, string>>;

type Viewer = { notify(holders: ViewerHolders): void };

/**
 * One active viewer per device.
 *
 * A browser tab registers as a viewer through its control socket and claims the
 * devices that it shows. Only the holder of a device gets its video, its
 * accessibility stream, and its input. Requests without a viewer ID (the CLI,
 * MCP agents, and other tools) are not restricted.
 */
export class ViewerLeases {
	private readonly viewers = new Map<string, Viewer>();
	private readonly holders = new Map<string, string>();
	private readonly losses = new Map<string, Set<() => void>>();

	/** `notify` runs when a holder changes. Read `snapshot()` for the start state. */
	register(notify: Viewer["notify"]): string {
		const id = randomUUID();
		this.viewers.set(id, { notify });
		return id;
	}

	unregister(viewer: string): void {
		if (!this.viewers.delete(viewer)) return;
		this.release(viewer, [...this.holders.keys()]);
	}

	claim(viewer: string, devices: readonly string[]): void {
		if (!this.viewers.has(viewer)) return;
		let changed = false;
		for (const device of devices) {
			const previous = this.holders.get(device);
			if (previous === viewer) continue;
			this.holders.set(device, viewer);
			changed = true;
			if (previous) this.lose(device, previous);
		}
		if (changed) this.broadcast();
	}

	release(viewer: string, devices: readonly string[]): void {
		let changed = false;
		for (const device of devices) {
			if (this.holders.get(device) !== viewer) continue;
			this.holders.delete(device);
			changed = true;
			this.lose(device, viewer);
		}
		if (changed) this.broadcast();
	}

	/** A request without a viewer ID, or for a device without a holder, is allowed. */
	allows(device: string, viewer: string | null | undefined): boolean {
		if (!viewer) return true;
		const holder = this.holders.get(device);
		return holder === undefined || holder === viewer;
	}

	/** Calls `listener` once when `viewer` stops being the holder of `device`. */
	onLoss(device: string, viewer: string, listener: () => void): () => void {
		const key = `${device}\0${viewer}`;
		let listeners = this.losses.get(key);
		if (!listeners) this.losses.set(key, (listeners = new Set()));
		listeners.add(listener);
		return () => {
			listeners.delete(listener);
			if (listeners.size === 0) this.losses.delete(key);
		};
	}

	snapshot(): ViewerHolders {
		return Object.fromEntries(this.holders);
	}

	private lose(device: string, viewer: string): void {
		const key = `${device}\0${viewer}`;
		const listeners = this.losses.get(key);
		if (!listeners) return;
		this.losses.delete(key);
		for (const listener of listeners) {
			try {
				listener();
			} catch {
				// A listener that fails must not stop the others.
			}
		}
	}

	private broadcast(): void {
		const holders = this.snapshot();
		for (const viewer of this.viewers.values()) viewer.notify(holders);
	}
}

export class Viewers extends Context.Tag("@agentsims/Viewers")<
	Viewers,
	ViewerLeases
>() {}

export const ViewersLive = Layer.sync(Viewers, () => new ViewerLeases());
