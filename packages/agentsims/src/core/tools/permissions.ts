import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import { androidSerialFromStateId } from "../android/device/identifiers";
import {
	listPermissions,
	resetAllPermissions,
	setPermission,
} from "../ios/permissions";
import {
	CommandUnavailable,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "./errors";

export const PermissionNameSchema = z.enum([
	"notifications",
	"location",
	"camera",
	"microphone",
	"photos",
	"photos-add",
	"contacts",
	"calendar",
	"reminders",
	"motion",
	"media-library",
	"siri",
	"speech",
	"faceid",
	"user-tracking",
	"homekit",
]);
export type PermissionName = z.infer<typeof PermissionNameSchema>;

export const BundleIdSchema = z
	.string()
	.regex(
		/^[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9][A-Za-z0-9-]*)+$/,
		"Invalid app bundle identifier",
	);

export const PermissionMutationSchema = z.discriminatedUnion("operation", [
	z.object({
		operation: z.enum(["grant", "revoke"]),
		bundleId: BundleIdSchema,
		permission: PermissionNameSchema,
		value: z
			.enum(["critical", "always", "inuse", "never", "limited"])
			.optional(),
	}),
	z.object({
		operation: z.literal("reset"),
		bundleId: BundleIdSchema,
		permission: PermissionNameSchema.optional(),
	}),
]);
export type PermissionMutation = z.infer<typeof PermissionMutationSchema>;
export const PermissionListQuerySchema = z.object({
	bundleId: BundleIdSchema.optional(),
});

export type PermissionOperationsService = {
	list(
		device: string,
		bundleId?: string,
	): Effect.Effect<unknown, ApplicationCommandError>;
	mutate(
		device: string,
		input: PermissionMutation,
	): Effect.Effect<{ ok: true }, ApplicationCommandError>;
};

export class PermissionOperations extends Context.Tag(
	"@agentsims/PermissionOperations",
)<PermissionOperations, PermissionOperationsService>() {}

function ensureIos(device: string): Effect.Effect<void, CommandUnavailable> {
	if (androidSerialFromStateId(device))
		return Effect.fail(
			new CommandUnavailable({
				message: "Android permission operations are not supported.",
			}),
		);
	if (process.platform !== "darwin")
		return Effect.fail(
			new CommandUnavailable({
				message: "iOS permission operations require a macOS server with Xcode.",
			}),
		);
	return Effect.void;
}

export const PermissionOperationsLive = Layer.succeed(
	PermissionOperations,
	PermissionOperations.of({
		list: (device, bundleId) =>
			ensureIos(device).pipe(
				Effect.flatMap(() =>
					Effect.tryPromise({
						try: () => listPermissions(device, bundleId),
						catch: commandFailure,
					}),
				),
			),
		mutate: (device, input) =>
			ensureIos(device).pipe(
				Effect.flatMap(() => {
					if (input.operation === "reset" && !input.permission)
						return Effect.tryPromise({
							try: () => resetAllPermissions(device, input.bundleId),
							catch: commandFailure,
						});
					if (!input.permission)
						return Effect.fail(
							new InvalidCommandInput({ message: "Permission is required" }),
						);
					return Effect.tryPromise({
						try: () =>
							setPermission(
								device,
								input.operation,
								input.permission!,
								input.bundleId,
								"value" in input ? input.value : undefined,
							),
						catch: commandFailure,
					});
				}),
				Effect.as({ ok: true as const }),
			),
	}),
);
