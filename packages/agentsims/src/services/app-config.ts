import { Context, Effect, Layer } from "effect";

export type StreamCodec = "auto" | "h264" | "mjpeg";

export type AppConfigValue = {
	host: string;
	port: number;
	basePath: string;
	codec: StreamCodec;
	proxyHelpers: boolean;
};

export type AppConfigOverrides = Partial<AppConfigValue>;
export type AppEnvironment = Readonly<Record<string, string | undefined>>;

export class InvalidAppConfigError extends Error {
	readonly _tag = "InvalidAppConfigError";
}

export class AppConfig extends Context.Tag("@agentsims/AppConfig")<
	AppConfig,
	AppConfigValue
>() {}

function portFromEnvironment(environment: AppEnvironment): number | undefined {
	const raw = environment.PORT?.trim();
	if (!raw) return undefined;
	if (!/^\d+$/.test(raw)) {
		throw new InvalidAppConfigError(
			`PORT must be an integer between 1 and 65535 (received '${raw}').`,
		);
	}
	const port = Number(raw);
	if (port < 1 || port > 65_535) {
		throw new InvalidAppConfigError(
			`PORT must be an integer between 1 and 65535 (received '${raw}').`,
		);
	}
	return port;
}

export function resolveAppConfig(
	overrides: AppConfigOverrides = {},
	environment: AppEnvironment = {},
): Effect.Effect<AppConfigValue, InvalidAppConfigError> {
	return Effect.try({
		try: () => ({
			host: overrides.host ?? (environment.HOST?.trim() || "127.0.0.1"),
			port: overrides.port ?? portFromEnvironment(environment) ?? 3200,
			basePath: overrides.basePath ?? "/",
			codec: overrides.codec ?? "auto",
			proxyHelpers: overrides.proxyHelpers ?? true,
		}),
		catch: (error) =>
			error instanceof InvalidAppConfigError
				? error
				: new InvalidAppConfigError(
						error instanceof Error ? error.message : String(error),
					),
	});
}

export function appConfigLayer(
	overrides: AppConfigOverrides = {},
	environment: AppEnvironment = {},
): Layer.Layer<AppConfig, InvalidAppConfigError> {
	return Layer.effect(AppConfig, resolveAppConfig(overrides, environment));
}
