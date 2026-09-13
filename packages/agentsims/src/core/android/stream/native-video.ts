import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredDistDirectory } from "../../native-paths";

export interface AvccFrame {
	data: Uint8Array;
	width: number;
	height: number;
	isDescription: boolean;
	isKeyframe: boolean;
}

const require = createRequire(import.meta.url);
const FLAG_DESCRIPTION = 1 << 0;
const FLAG_KEYFRAME = 1 << 1;

type RawFrameCallback = (frame: [Uint8Array, number, number, number]) => void;

interface AndroidVideoCaptureHandle {
	frame(width: number, height: number): void | Promise<void>;
	requestKeyframe(): void | Promise<void>;
	stop(): void | Promise<void>;
}

interface AndroidVideoAddon {
	AndroidVideoCapture: new (
		path: string,
		onFrame: RawFrameCallback,
	) => AndroidVideoCaptureHandle;
}

function resolveAddon(): string {
	const filename = "agentsims-native.node";
	const configuredDist = configuredDistDirectory();
	const moduleDirectory = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		...(configuredDist ? [join(configuredDist, "native", filename)] : []),
		join(dirname(process.execPath), "native", filename),
		join(moduleDirectory, "native", filename),
		join(moduleDirectory, "..", "..", "..", "..", "dist", "native", filename),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}
	throw new Error(
		`${filename} not found. Looked in:\n  ${candidates.join("\n  ")}\n` +
			"Run the Agentsims build to compile the native Android video addon.",
	);
}

let addon: AndroidVideoAddon | undefined;
function load(): AndroidVideoAddon {
	if (!addon) addon = require(resolveAddon()) as AndroidVideoAddon;
	return addon;
}

/** Latest-only emulator encoder using VideoToolbox on macOS. */
export class NativeAndroidVideoCapture {
	private readonly path: string;
	private handle: AndroidVideoCaptureHandle | null = null;
	private stopping: Promise<void> | undefined;

	constructor(path: string) {
		this.path = path;
	}

	async subscribeAvcc(
		onFrame: (frame: AvccFrame) => Promise<void>,
	): Promise<() => Promise<void>> {
		if (this.handle)
			throw new Error("Android video capture already has a subscriber");
		const next = new (load().AndroidVideoCapture)(
			this.path,
			([data, width, height, flags]) => {
				return onFrame({
					data,
					width,
					height,
					isDescription: (flags & FLAG_DESCRIPTION) !== 0,
					isKeyframe: (flags & FLAG_KEYFRAME) !== 0,
				});
			},
		);
		this.handle = next;
		return () => this.stop();
	}

	frame(width: number, height: number): void {
		this.handle?.frame(width, height);
	}

	requestKeyframe(): void {
		this.handle?.requestKeyframe();
	}

	stop(): Promise<void> {
		if (this.stopping) return this.stopping;
		const handle = this.handle;
		this.handle = null;
		this.stopping = Promise.resolve(handle?.stop());
		return this.stopping;
	}
}
