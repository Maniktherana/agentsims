/** A response remains charged until its stdio write completes or EOF cancels it. */
export class McpOutputReservations {
	private readonly entries = new Map<string | number, { release: () => Promise<void>; closing?: Promise<void> }>();
	private closed = false;
	private closing?: Promise<void>;
	get pending(): number { return this.entries.size; }
	hold(requestId: string | number, release: () => Promise<void>): void {
		if (this.closed) throw new Error("The MCP output scope is closed.");
		if (this.entries.has(requestId)) throw new Error("This MCP request already owns a retained response.");
		if (this.entries.size >= 32) throw new Error("The MCP connection has too many retained responses.");
		this.entries.set(requestId, { release });
	}
	finish(requestId: string | number): Promise<void> {
		const entry = this.entries.get(requestId);
		if (!entry) return Promise.resolve();
		return entry.closing ??= Promise.resolve().then(entry.release).finally(() => { this.entries.delete(requestId); });
	}
	close(): Promise<void> {
		this.closed = true;
		return this.closing ??= Promise.allSettled(Array.from(this.entries.keys(), (id) => this.finish(id))).then(() => {});
	}
}
