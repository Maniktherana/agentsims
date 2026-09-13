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

/** Build foreground-app reads from injected platform operations. */
export const foregroundAppsLayer = <R>(
	reads: Effect.Effect<ForegroundAppReads, never, R>,
) =>
	Layer.effect(
		ForegroundApps,
		Effect.map(reads, (platform) =>
			ForegroundApps.of({
				read: (device) =>
					(device.startsWith("android:")
						? platform.readAndroid(device)
						: platform.readIos(device)
					).pipe(Effect.map(decodeForegroundApp)),
			}),
		),
	);
