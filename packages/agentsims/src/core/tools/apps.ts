import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import { AndroidTools } from "../android/device/tools";
import { androidSerialFromStateId } from "../android/device/identifiers";
import {
	installApp,
	appDetails,
	launchApp,
	listApps,
	terminateApp,
	uninstallApp,
} from "../ios/apps";
import {
	CommandUnavailable,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "./errors";

export const AppOperationSchema = z.object({
	operation: z.enum([
		"list",
		"details",
		"launch",
		"stop",
		"install",
		"uninstall",
	]),
	value: z.string().optional(),
});
export type AppOperation = z.infer<typeof AppOperationSchema>;

function requireValue(
	input: AppOperation,
): Effect.Effect<string, InvalidCommandInput> {
	return input.value
		? Effect.succeed(input.value)
		: Effect.fail(
				new InvalidCommandInput({
					message: `The ${input.operation} operation requires a value`,
				}),
			);
}

export type AppsService = {
	execute(
		device: string,
		input: AppOperation,
	): Effect.Effect<unknown, ApplicationCommandError>;
};
export class Apps extends Context.Tag("@agentsims/Apps")<Apps, AppsService>() {}

export const AppsLive = Layer.effect(
	Apps,
	Effect.gen(function* () {
		const android = yield* AndroidTools;
		const cache = new Map<string, unknown>();
		return Apps.of({
			execute: (device, input) => {
				const serial = androidSerialFromStateId(device);
				if (input.operation === "details")
					return requireValue(input).pipe(
						Effect.flatMap((bundleId) => {
							const key = `${device}:${bundleId}`;
							if (cache.has(key)) return Effect.succeed(cache.get(key));
							const read = serial
								? android.details(device, bundleId)
								: Effect.tryPromise({
										try: () => appDetails(device, bundleId),
										catch: commandFailure,
									});
							return read.pipe(
								Effect.tap((details) =>
									Effect.sync(() => {
										if (cache.size >= 128)
											cache.delete(cache.keys().next().value!);
										cache.set(key, details);
									}),
								),
							);
						}),
						Effect.mapError(commandFailure),
					);
				if (serial) {
					if (input.operation === "list")
						return android.execute(device, { type: "apps" });
					return requireValue(input).pipe(
						Effect.flatMap((value) =>
							input.operation === "install"
								? android.execute(device, { type: "install", path: value })
								: android.execute(device, {
										type: "app",
										operation: input.operation,
										package: value,
									}),
						),
						Effect.mapError(commandFailure),
					);
				}
				if (process.platform !== "darwin")
					return Effect.fail(
						new CommandUnavailable({
							message: "iOS app operations require a macOS server with Xcode.",
						}),
					);
				const operation: Effect.Effect<unknown, ApplicationCommandError> =
					input.operation === "list"
						? Effect.tryPromise({
								try: () => listApps(device),
								catch: commandFailure,
							})
						: requireValue(input).pipe(
								Effect.flatMap((value) =>
									Effect.tryPromise({
										try: async () => {
											if (input.operation === "launch")
												return launchApp(device, value);
											if (input.operation === "stop")
												await terminateApp(device, value);
											else if (input.operation === "install")
												await installApp(device, value);
											else await uninstallApp(device, value);
											return { ok: true };
										},
										catch: commandFailure,
									}),
								),
							);
				return operation.pipe(Effect.mapError(commandFailure));
			},
		});
	}),
);
