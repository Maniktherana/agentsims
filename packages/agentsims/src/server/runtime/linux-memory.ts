export interface LinuxMemorySnapshot {
	totalBytes: number | null;
	availableBytes: number | null;
}

/** MemAvailable accounts for reclaimable caches; MemFree alone does not. */
export function parseLinuxMemory(text: string): LinuxMemorySnapshot {
	const read = (name: string): number | null => {
		const match = text.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "m"));
		if (!match) return null;
		const bytes = Number(match[1]) * 1024;
		return Number.isSafeInteger(bytes) ? bytes : null;
	};
	const totalBytes = read("MemTotal");
	const availableBytes = read("MemAvailable");
	return {
		totalBytes,
		availableBytes:
			availableBytes === null
				? null
				: totalBytes === null
					? availableBytes
					: Math.min(totalBytes, availableBytes),
	};
}
