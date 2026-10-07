import { mock } from "bun:test";
import {
	AVCC_TAG_DESCRIPTION,
	AVCC_TAG_KEYFRAME,
	AVCC_TAG_SEED,
	avccEnvelope,
} from "../../core/stream/avcc-wire";
import { landscapeStream } from "./avcc-streams";

type Scenario = "seed" | "decoded" | "empty" | "no-context";
type StreamState = {
	paints: number;
	firstFrames: number;
	decodedFrames: number;
	cancellations: number;
	transports: boolean[];
	retryScheduled: boolean;
};
export type AvccEffectResult = Record<
	Scenario,
	{ before: StreamState; after: StreamState }
>;

let effect: (() => void | (() => void)) | undefined;
// This fixture runs in its own Bun process. React and browser mocks cannot
// replace modules or globals used by other tests in the parent process.
mock.module("react", () => ({
	useEffect: (callback: () => void | (() => void)) => {
		effect = callback;
	},
	useRef: (current: unknown) => ({ current }),
}));
const { useAvccStream } = await import("../../web/hooks/simulator/use-avcc-stream");
const originalTimeout = globalThis.setTimeout;

async function runScenario(scenario: Scenario) {
	let now = 0;
	let nextId = 1;
	let paints = 0;
	let firstFrames = 0;
	let decodedFrames = 0;
	let cancellations = 0;
	let closedFrames = 0;
	const transports: boolean[] = [];
	const timers = new Map<number, { due: number; callback: () => void }>();
	const rafs = new Map<number, FrameRequestCallback>();
	Date.now = () => now;
	globalThis.setTimeout = ((callback: () => void, delay = 0) => {
		const id = nextId++;
		timers.set(id, { due: now + delay, callback });
		return id;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((id: number) => {
		timers.delete(id);
	}) as unknown as typeof clearTimeout;
	globalThis.requestAnimationFrame = (callback) => {
		const id = nextId++;
		rafs.set(id, callback);
		return id;
	};
	globalThis.cancelAnimationFrame = (id) => {
		rafs.delete(id);
	};
	const closeFrame = () => { closedFrames++; };
	globalThis.createImageBitmap = (async () => ({
		width: landscapeStream.width,
		height: landscapeStream.height,
		close: closeFrame,
	})) as unknown as typeof createImageBitmap;
	globalThis.EncodedVideoChunk = class {} as unknown as typeof EncodedVideoChunk;
	globalThis.VideoDecoder = class {
		state = "unconfigured";
		constructor(private callbacks: VideoDecoderInit) {}
		configure() { this.state = "configured"; }
		decode() {
			decodedFrames++;
			this.callbacks.output({
				displayWidth: landscapeStream.width,
				displayHeight: landscapeStream.height,
				close: closeFrame,
			} as VideoFrame);
		}
		close() { this.state = "closed"; }
	} as unknown as typeof VideoDecoder;

	const chunks: Uint8Array[] = [];
	if (scenario === "seed") {
		chunks.push(avccEnvelope(AVCC_TAG_SEED, new Uint8Array([0xff, 0xd8, 0xff, 0xd9])));
	} else if (scenario !== "empty") {
		chunks.push(avccEnvelope(AVCC_TAG_DESCRIPTION, landscapeStream.description));
		chunks.push(avccEnvelope(AVCC_TAG_KEYFRAME, landscapeStream.frames[0]!.data));
	}
	globalThis.fetch = (async (_input, options) => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(chunk);
				options?.signal?.addEventListener("abort", () => {
					controller.error(new DOMException("Aborted", "AbortError"));
				}, { once: true });
			},
			cancel() { cancellations++; },
		});
		return new Response(body, {
			headers: { "content-type": "application/octet-stream" },
		});
	}) as typeof fetch;
	const canvas = {
		width: 0,
		height: 0,
		getContext: () => scenario === "no-context" ? null : {
			drawImage() { paints++; },
		},
	} as unknown as HTMLCanvasElement;
	useAvccStream({
		url: "http://avcc-fixture.invalid",
		enabled: true,
		canvasRef: { current: canvas },
		onFirstFrame: () => { firstFrames++; },
		onTransportChange: (connected) => { transports.push(connected); },
	});
	if (!effect) throw new Error("The stream effect did not register");
	const cleanup = effect();

	const settle = async () => {
		for (let index = 0; index < 3; index++) {
			await new Promise<void>((resolve) => originalTimeout(resolve, 0));
			for (const [id, callback] of rafs) {
				rafs.delete(id);
				callback(now);
			}
		}
	};
	const snapshot = (): StreamState => ({
		paints, firstFrames, decodedFrames, cancellations,
		transports: [...transports],
		retryScheduled: [...timers.values()].some((timer) => timer.due - now === 1_000),
	});
	await settle();
	const before = snapshot();
	// Advance past startup timeout, but stop before the resulting retry fires.
	now = 8_001;
	for (const [id, timer] of timers) {
		if (timer.due > now) continue;
		timers.delete(id);
		timer.callback();
	}
	await settle();
	const after = snapshot();
	cleanup?.();
	await settle();
	if (closedFrames !== paints + (scenario === "no-context" ? 1 : 0)) {
		throw new Error("The fixture did not release its image resources");
	}
	return { before, after };
}

const results = {} as AvccEffectResult;
for (const scenario of ["seed", "decoded", "empty", "no-context"] as const) {
	results[scenario] = await runScenario(scenario);
}
console.log(JSON.stringify(results));
