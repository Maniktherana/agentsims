import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";
import { androidSerialFromStateId } from "../../android/device/device";
import type { DevToolsProvider, DevToolsProviderTarget } from "./model";

export type AndroidCdpAdapterService = {
	command(
		serial: string,
		args: readonly string[],
	): Effect.Effect<string, unknown>;
	targets(port: number): Effect.Effect<unknown, unknown>;
};

export class AndroidCdpAdapter extends Context.Tag(
	"@agentsims/AndroidCdpAdapter",
)<AndroidCdpAdapter, AndroidCdpAdapterService>() {}

export const AndroidCdpAdapterLive = Layer.effect(
	AndroidCdpAdapter,
	Effect.gen(function* () {
		const executor = yield* CommandExecutor;
		return {
			command: (serial, args) =>
				executor.string(Command.make("adb", "-s", serial, ...args)),
			targets: (port) =>
				Effect.tryPromise(async () => {
					const response = await fetch(`http://127.0.0.1:${port}/json`);
					if (!response.ok) {
						throw new Error(`CDP target request failed: ${response.status}`);
					}
					return response.json();
				}),
		};
	}),
);

export class AndroidDevTools extends Context.Tag("@agentsims/AndroidDevTools")<
	AndroidDevTools,
	DevToolsProvider
>() {}

type CdpTarget = {
	id?: string;
	title?: string;
	url?: string;
	type?: string;
	description?: string;
	webSocketDebuggerUrl?: string;
};

function cdpWebSocketUrl(value: string, port: number): string | null {
	try {
		const url = new URL(value);
		url.protocol = "ws:";
		url.hostname = "127.0.0.1";
		url.port = String(port);
		return url.toString();
	} catch {
		return null;
	}
}

function decodeTargets(
	value: unknown,
	device: string,
	port: number,
): DevToolsProviderTarget[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => {
		const target = entry as CdpTarget;
		const webSocketUrl = target.webSocketDebuggerUrl
			? cdpWebSocketUrl(target.webSocketDebuggerUrl, port)
			: null;
		if (!target.id || !webSocketUrl) return [];
		return [
			{
				id: target.id,
				device,
				provider: "android-cdp" as const,
				title: target.title || target.url || "Untitled",
				url: target.url || "about:blank",
				type: target.type || "page",
				appName: target.description || "Chrome",
				webSocketUrl,
			},
		];
	});
}

export const AndroidDevToolsLive = Layer.scoped(
	AndroidDevTools,
	Effect.gen(function* () {
		const adapter = yield* AndroidCdpAdapter;
		const forwards = new Map<string, number>();
		const ensureForward = (serial: string) => {
			const existing = forwards.get(serial);
			if (existing) return Effect.succeed(existing);
			return adapter
				.command(serial, [
					"forward",
					"tcp:0",
					"localabstract:chrome_devtools_remote",
				])
				.pipe(
					Effect.flatMap((output) => {
						const port = Number(output.trim());
						if (!Number.isInteger(port) || port <= 0) {
							return Effect.fail(
								new Error(`ADB returned an invalid CDP port: ${output.trim()}`),
							);
						}
						return Effect.sync(() => {
							forwards.set(serial, port);
							return port;
						});
					}),
				);
		};
		yield* Effect.addFinalizer(() =>
			Effect.forEach(
				forwards,
				([serial, port]) =>
					adapter
						.command(serial, ["forward", "--remove", `tcp:${port}`])
						.pipe(Effect.ignore),
				{ discard: true },
			),
		);
		return {
			list: (device) => {
				const serial = androidSerialFromStateId(device);
				if (!serial) return Effect.succeed([]);
				return ensureForward(serial).pipe(
					Effect.flatMap((port) =>
						adapter
							.targets(port)
							.pipe(
								Effect.map((targets) => decodeTargets(targets, device, port)),
							),
					),
					Effect.catchAll(() => Effect.succeed([])),
				);
			},
		} satisfies DevToolsProvider;
	}),
);
