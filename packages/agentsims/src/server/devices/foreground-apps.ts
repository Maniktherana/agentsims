import { Context, Effect, Layer } from "effect";
import {
	androidSerialFromStateId,
	getAndroidForegroundApp,
} from "../../core/android/device/device";
import { IosSessions } from "../../core/ios/session";
import {
	decodeForegroundApp,
	type ForegroundApp,
} from "../../core/tools/devices/foreground-apps";

export type ForegroundAppsService = {
	read(device: string): Effect.Effect<ForegroundApp | null>;
};

export class ForegroundApps extends Context.Tag("@agentsims/ForegroundApps")<
	ForegroundApps,
	ForegroundAppsService
>() {}

export const ForegroundAppsLive = Layer.effect(
	ForegroundApps,
	Effect.gen(function* () {
		const iosSessions = yield* IosSessions;
		return ForegroundApps.of({
			read: (device) => {
				const serial = androidSerialFromStateId(device);
				return serial
					? Effect.promise(() => getAndroidForegroundApp(serial))
					: Effect.flatMap(iosSessions.get(device), (session) =>
							Effect.promise(() => session.readForeground()).pipe(
								Effect.map(decodeForegroundApp),
							),
						).pipe(
							Effect.catchTag("IosHostUnavailable", () => Effect.succeed(null)),
						);
			},
		});
	}),
);
