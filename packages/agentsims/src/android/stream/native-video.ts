import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredDistDirectory } from "../../server/runtime/runtime-paths";
import type { AvccFrame } from "../../ios/stream/native";

const require = createRequire(import.meta.url);
const FLAG_DESCRIPTION = 1 << 0;
const FLAG_KEYFRAME = 1 << 1;

type RawFrameCallback = (frame: [Uint8Array, number, number, number]) => void;

interface AndroidVideoCaptureHandle {
	frame(width: number, height: number): void;
	requestKeyframe(): void;
	stop(): void;
}

interface AndroidVideoAddon {
	AndroidVideoCapture: new (
		path: string,
		onFrame: RawFrameCallback,
	) => AndroidVideoCaptureHandle;
}

function resolveAddon(): string {
	const configuredDist = configuredDistDirectory();
	const moduleDirectory = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		...(configuredDist
			? [join(configuredDist, "native", "agentsims-android-video.node")]
			: []),
		join(dirname(process.execPath), "native", "agentsims-android-video.node"),
		join(moduleDirectory, "native", "agentsims-android-video.node"),
		join(
			moduleDirectory,
			"..",
			"..",
			"..",
			"dist",
			"native",
			"agentsims-android-video.node",
		),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(
		`agentsims-android-video.node not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run the Agentsims build to compile the native Android video addon.",
	);
}

let addon: AndroidVideoAddon | undefined;
function load(): AndroidVideoAddon {
	if (!addon) addon = require(resolveAddon()) as AndroidVideoAddon;
	return addon;
}

/** Latest-only Android Emulator MMAP encoder backed by native FFmpeg. */
export class NativeAndroidVideoCapture {
	private readonly path: string;
	private handle: AndroidVideoCaptureHandle | null = null;

	constructor(path: string) {
		this.path = path;
	}

	async subscribeAvcc(
		onFrame: (frame: AvccFrame) => Promise<void>,
	): Promise<() => void> {
		if (this.handle)
			throw new Error("Android video capture already has a subscriber");
		const next = new (load().AndroidVideoCapture)(
			this.path,
			([data, width, height, flags]) => {
				void onFrame({
					data,
					width,
					height,
					isDescription: (flags & FLAG_DESCRIPTION) !== 0,
					isKeyframe: (flags & FLAG_KEYFRAME) !== 0,
				});
			},
		);
		this.handle = next;
		let active = true;
		return () => {
			if (!active) return;
			active = false;
			next.stop();
			if (this.handle === next) this.handle = null;
		};
	}

	frame(width: number, height: number): void {
		this.handle?.frame(width, height);
	}

	requestKeyframe(): void {
		this.handle?.requestKeyframe();
	}

	stop(): void {
		this.handle?.stop();
		this.handle = null;
	}
}
