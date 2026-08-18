import { Context, Effect, Layer } from "effect";
import { androidSerialFromStateId } from "../../android/device/device";
import { AndroidDevTools } from "./android";
import type {
	DevToolsProvider,
	DevToolsProviderTarget,
	DevToolsTarget,
} from "./model";
import { WebKitDevTools } from "./webkit";

export type DevToolsService = {
	list(device: string): Effect.Effect<DevToolsTarget[], unknown>;
	webSocketUrl(targetId: string): Effect.Effect<string, Error>;
	highlight(targetId: string, on: boolean): Effect.Effect<void, unknown>;
	releaseHighlights(): Effect.Effect<void>;
};

export class DevTools extends Context.Tag("@agentsims/DevTools")<
	DevTools,
	DevToolsService
>() {}

type IndexedTarget = {
	target: DevToolsProviderTarget;
	provider: DevToolsProvider;
};

function publicTargetId(target: DevToolsProviderTarget): string {
	return `${target.provider}:${Buffer.from(
		JSON.stringify([target.device, target.id]),
	).toString("base64url")}`;
}

export const DevToolsLive = Layer.effect(
	DevTools,
	Effect.gen(function* () {
		const webkit = yield* WebKitDevTools;
		const android = yield* AndroidDevTools;
		const targets = new Map<string, IndexedTarget>();
		const providerFor = (device: string) =>
			androidSerialFromStateId(device) ? android : webkit;
		return DevTools.of({
			list: (device) => {
				const provider = providerFor(device);
				return provider.list(device).pipe(
					Effect.map((found) => {
						for (const [key, value] of targets) {
							if (value.target.device === device) targets.delete(key);
						}
						return found.map((target) => {
							const id = publicTargetId(target);
							targets.set(id, { target, provider });
							const { webSocketUrl: _, ...publicTarget } = target;
							return { ...publicTarget, id };
						});
					}),
				);
			},
			webSocketUrl: (targetId) => {
				const indexed = targets.get(targetId);
				return indexed
					? Effect.succeed(indexed.target.webSocketUrl)
					: Effect.fail(new Error("DevTools target is no longer available"));
			},
			highlight: (targetId, on) => {
				const indexed = targets.get(targetId);
				return indexed?.provider.highlight
					? indexed.provider.highlight(indexed.target.id, on)
					: Effect.void;
			},
			releaseHighlights: () =>
				Effect.all([
					webkit.releaseHighlights?.() ?? Effect.void,
					android.releaseHighlights?.() ?? Effect.void,
				]).pipe(Effect.asVoid),
		});
	}),
);
