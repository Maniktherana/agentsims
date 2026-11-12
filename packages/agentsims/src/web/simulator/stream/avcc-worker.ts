/**
 * Dedicated worker that owns one simulator canvas. The page transfers the
 * canvas once; later messages change the stream source and the size.
 */
import { AvccPlayer, type AvccPlayerEvent } from "./avcc-player.js";
import type { AvccWorkerRequest, AvccWorkerReply } from "./avcc-worker-protocol.js";

type WorkerScope = {
	onmessage: ((event: MessageEvent<AvccWorkerRequest>) => void) | null;
	postMessage(message: AvccWorkerReply, transfer?: Transferable[]): void;
};

const scope = self as unknown as WorkerScope;
let player: AvccPlayer | null = null;

const emit = (event: AvccPlayerEvent) =>
	scope.postMessage(event, event.type === "still" ? [event.bitmap] : []);

scope.onmessage = ({ data }) => {
	switch (data.type) {
		case "init":
			player?.dispose();
			player = new AvccPlayer(data.canvas, emit);
			return;
		case "start":
			player?.start(data.source);
			return;
		case "stop":
			player?.stop();
			return;
		case "resize":
			player?.resize(data.display);
			return;
		case "capture":
			void (player?.capture() ?? Promise.resolve(null)).then(
				(bitmap) =>
					scope.postMessage(
						{ type: "capture", id: data.id, bitmap },
						bitmap ? [bitmap] : [],
					),
				() => scope.postMessage({ type: "capture", id: data.id, bitmap: null }),
			);
			return;
	}
};
