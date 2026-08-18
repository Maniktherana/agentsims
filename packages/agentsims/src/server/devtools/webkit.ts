import { Command } from "@effect/platform";
import { CommandExecutor } from "@effect/platform/CommandExecutor";
import { Context, Effect, Layer } from "effect";
import {
	startInspectWebKitBridge,
	type WebKitBridge,
} from "../http/devtools-bridge";
import type { DevToolsProvider } from "./model";

export class WebKitDevTools extends Context.Tag("@agentsims/WebKitDevTools")<
	WebKitDevTools,
	DevToolsProvider
>() {}

export const webKitDevToolsLayer = (
	start: () => Promise<WebKitBridge> = startInspectWebKitBridge,
) =>
	Layer.scoped(
		WebKitDevTools,
		Effect.gen(function* () {
			const executor = yield* CommandExecutor;
			const sourceDevices = new Map<string, string | null>();
			const deviceForSource = (source: string | undefined) => {
				const normalizedSource = /^\d+$/.test(source ?? "")
					? `sim:${source}`
					: source;
				if (!normalizedSource?.startsWith("sim:")) {
					return Effect.succeed(normalizedSource ?? null);
				}
				const cached = sourceDevices.get(normalizedSource);
				if (cached !== undefined) return Effect.succeed(cached);
				const pid = normalizedSource.slice(4);
				return executor
					.string(Command.make("ps", "-p", pid, "-o", "command="))
					.pipe(
						Effect.map(
							(output) =>
								output.match(/CoreSimulator\/Devices\/([0-9A-F-]+)\//i)?.[1] ??
								null,
						),
						Effect.catchAll(() => Effect.succeed(null)),
						Effect.tap((targetDevice) =>
							Effect.sync(() =>
								sourceDevices.set(normalizedSource, targetDevice),
							),
						),
					);
			};
			let bridge: Promise<WebKitBridge> | null = null;
			const getBridge = () => (bridge ??= start());
			yield* Effect.addFinalizer(() => {
				const current = bridge;
				return current
					? Effect.promise(() =>
							current.then(
								(value) => value.close?.(),
								() => undefined,
							),
						)
					: Effect.void;
			});
			return {
				list: (device) =>
					Effect.tryPromise(getBridge).pipe(
						Effect.flatMap((value) =>
							Effect.tryPromise(() => value.listTargets()).pipe(
								Effect.map((targets) => [value, targets] as const),
							),
						),
						Effect.flatMap(([value, targets]) =>
							Effect.forEach(targets, (target) =>
								deviceForSource(target.udid).pipe(
									Effect.map((targetDevice) => ({ target, targetDevice })),
								),
							).pipe(Effect.map((resolved) => [value, resolved] as const)),
						),
						Effect.map(([value, targets]) =>
							targets
								.filter(({ targetDevice }) => targetDevice === device)
								.map(({ target }) => ({
									...target,
									device,
									provider: "webkit" as const,
									webSocketUrl: `ws://127.0.0.1:${value.port}/devtools/page/${encodeURIComponent(target.id)}`,
								})),
						),
					),
				highlight: (targetId, on) =>
					Effect.tryPromise(getBridge).pipe(
						Effect.flatMap((value) =>
							value.highlightTarget
								? Effect.tryPromise(() => value.highlightTarget!(targetId, on))
								: Effect.void,
						),
					),
				releaseHighlights: () =>
					bridge
						? Effect.promise(() =>
								bridge!.then((value) => value.releaseHighlight?.()),
							)
						: Effect.void,
			} satisfies DevToolsProvider;
		}),
	);

export const WebKitDevToolsLive = webKitDevToolsLayer();
