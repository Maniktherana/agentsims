import { Context, Effect, Layer } from "effect";
import { z } from "zod";

const ForegroundAppSchema = z.object({
	bundleId: z.string().min(1),
	isReactNative: z.boolean().optional().default(false),
	pid: z.number().optional(),
});
export type ForegroundApp = z.infer<typeof ForegroundAppSchema>;

export function decodeForegroundApp(value: unknown): ForegroundApp | null {
	const result = ForegroundAppSchema.safeParse(value);
	return result.success ? result.data : null;
}

export function decodeForegroundAppEvent(data: string): ForegroundApp | null {
	try {
		return decodeForegroundApp(JSON.parse(data));
	} catch {
		return null;
	}
}

export type ForegroundAppsService = {
	read(device: string): Effect.Effect<ForegroundApp | null>;
};

export class ForegroundApps extends Context.Tag("@agentsims/ForegroundApps")<
	ForegroundApps,
	ForegroundAppsService
>() {}

export type ForegroundAppReads = {
	readAndroid(device: string): Effect.Effect<unknown>;
	readIos(device: string): Effect.Effect<unknown>;
};

/** A read spawns `adb` or queries accessibility. Callers in this window share one read. */
const FOREGROUND_SHARE_MS = 2_000;

/** Build foreground-app reads from injected platform operations. */
export const foregroundAppsLayer = <R>(
	reads: Effect.Effect<ForegroundAppReads, never, R>,
) =>
	Layer.effect(
		ForegroundApps,
		Effect.map(reads, (platform) => {
			const recent = new Map<
				string,
				{ at: number; value: Promise<ForegroundApp | null> }
			>();
			return ForegroundApps.of({
				read: (device) =>
					Effect.suspend(() => {
						const hit = recent.get(device);
						if (hit && Date.now() - hit.at < FOREGROUND_SHARE_MS)
							return Effect.promise(() => hit.value);
						const value = Effect.runPromise(
							(device.startsWith("android:")
								? platform.readAndroid(device)
								: platform.readIos(device)
							).pipe(Effect.map(decodeForegroundApp)),
						).catch(() => null);
						recent.set(device, { at: Date.now(), value });
						return Effect.promise(() => value);
					}),
			});
		}),
	);
