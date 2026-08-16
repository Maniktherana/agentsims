export class ScopedResourceRegistry<Key, Resource> {
	private readonly resources = new Map<Key, Resource>();

	constructor(
		private readonly acquire: (key: Key) => Resource,
		private readonly release: (resource: Resource) => void | Promise<void>,
	) {}

	get(key: Key): Resource {
		const existing = this.resources.get(key);
		if (existing) return existing;
		const resource = this.acquire(key);
		this.resources.set(key, resource);
		return resource;
	}

	async close(key: Key): Promise<void> {
		const resource = this.resources.get(key);
		if (!resource) return;
		this.resources.delete(key);
		await this.release(resource);
	}

	async closeAll(): Promise<void> {
		const resources = [...this.resources.values()];
		this.resources.clear();
		await Promise.allSettled(
			resources.map((resource) => this.release(resource)),
		);
	}
}
