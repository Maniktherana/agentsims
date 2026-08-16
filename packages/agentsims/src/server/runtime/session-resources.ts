import { Effect, Layer } from "effect";
import { androidSessions } from "../../android/session/session";
import { iosSessions } from "../../ios/session/session";

export const SessionResourcesLive = Layer.scopedDiscard(
	Effect.addFinalizer(() =>
		Effect.promise(async () => {
			await Promise.allSettled([
				androidSessions.closeAll(),
				iosSessions.closeAll(),
			]);
		}),
	),
);
