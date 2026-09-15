import { Context, Effect, Layer } from "effect";
import { z } from "zod";
import { androidSerialFromStateId } from "../android/device/identifiers";
import {
	listAndroidPermissions,
	normalizeAndroidPermission,
	resetAndroidPermission,
	resetAndroidPermissions,
	setAndroidPermission,
} from "../android/permissions";
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

/** Android package names allow underscores, which a bundle identifier does not. */
export const AndroidPackageSchema = z
	.string()
	.regex(
		/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/,
		"Invalid Android package name",
	);

export const AppIdSchema = z.union([BundleIdSchema, AndroidPackageSchema]);

export const PermissionMutationSchema = z.discriminatedUnion("operation", [
	z.object({
		operation: z.enum(["grant", "revoke"]),
		bundleId: AppIdSchema,
		permission: z.string().min(1),
		value: z
			.enum(["critical", "always", "inuse", "never", "limited"])
			.optional(),
	}),
	z.object({
		operation: z.literal("reset"),
		bundleId: AppIdSchema,
		permission: z.string().min(1).optional(),
	}),
]);
export type PermissionMutation = z.infer<typeof PermissionMutationSchema>;
export const PermissionListQuerySchema = z.object({
	bundleId: AppIdSchema.optional(),
});

/** An Android reset reports the permissions that it could not revoke. */
export type PermissionMutationResult = {
	ok: true;
	revoked?: string[];
	skipped?: { permission: string; reason: string }[];
};

export type PermissionOperationsService = {
	list(
		device: string,
		bundleId?: string,
	): Effect.Effect<unknown, ApplicationCommandError>;
	mutate(
		device: string,
		input: PermissionMutation,
	): Effect.Effect<PermissionMutationResult, ApplicationCommandError>;
};

export class PermissionOperations extends Context.Tag(
	"@agentsims/PermissionOperations",
)<PermissionOperations, PermissionOperationsService>() {}

function ensureIosHost(): Effect.Effect<void, CommandUnavailable> {
	if (process.platform !== "darwin")
		return Effect.fail(
			new CommandUnavailable({
				message: "iOS permission operations require a macOS server with Xcode.",
			}),
		);
	return Effect.void;
}

/** Android names a runtime permission. iOS names a privacy service. */
function iosPermission(
	name: string,
): Effect.Effect<PermissionName, InvalidCommandInput> {
	const parsed = PermissionNameSchema.safeParse(name);
	return parsed.success
		? Effect.succeed(parsed.data)
		: Effect.fail(new InvalidCommandInput({ message: `Unknown permission: ${name}` }));
}

function androidPermission(
	name: string,
): Effect.Effect<string, InvalidCommandInput> {
	const normalized = normalizeAndroidPermission(name);
	return normalized
		? Effect.succeed(normalized)
		: Effect.fail(new InvalidCommandInput({ message: `Unknown permission: ${name}` }));
}

function requirePackage(
	bundleId: string | undefined,
): Effect.Effect<string, InvalidCommandInput> {
	return bundleId
		? Effect.succeed(bundleId)
		: Effect.fail(
				new InvalidCommandInput({
					message: "Android permission operations require an app package name.",
				}),
			);
}

export const PermissionOperationsLive = Layer.succeed(
	PermissionOperations,
	PermissionOperations.of({
		list: (device, bundleId) => {
			const serial = androidSerialFromStateId(device);
			if (serial)
				return requirePackage(bundleId).pipe(
					Effect.flatMap((packageName) =>
						Effect.tryPromise({
							try: () => listAndroidPermissions(serial, packageName),
							catch: commandFailure,
						}),
					),
				);
			return ensureIosHost().pipe(
				Effect.flatMap(() =>
					Effect.tryPromise({
						try: () => listPermissions(device, bundleId),
						catch: commandFailure,
					}),
				),
			);
		},
		mutate: (device, input) => {
			const serial = androidSerialFromStateId(device);
			if (serial) return androidMutate(serial, input);
			return ensureIosHost().pipe(
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
					return iosPermission(input.permission).pipe(
						Effect.flatMap((permission) =>
							Effect.tryPromise({
								try: () =>
									setPermission(
										device,
										input.operation,
										permission,
										input.bundleId,
										"value" in input ? input.value : undefined,
									),
								catch: commandFailure,
							}),
						),
					);
				}),
				Effect.as({ ok: true as const }),
			);
		},
	}),
);

function androidMutate(
	serial: string,
	input: PermissionMutation,
): Effect.Effect<PermissionMutationResult, ApplicationCommandError> {
	if (input.operation === "reset") {
		const { permission, bundleId } = input;
		// Without a name, every runtime permission of the app is reset.
		if (!permission)
			return Effect.tryPromise({
				try: () => resetAndroidPermissions(serial, bundleId),
				catch: commandFailure,
			}).pipe(Effect.map((reset) => ({ ok: true as const, ...reset })));
		return androidPermission(permission).pipe(
			Effect.flatMap((name) =>
				Effect.tryPromise({
					try: () => resetAndroidPermission(serial, name, bundleId),
					catch: commandFailure,
				}),
			),
			Effect.as({ ok: true as const }),
		);
	}
	if ("value" in input && input.value !== undefined)
		return Effect.fail(
			new InvalidCommandInput({
				message: "Android permissions have no value. Use grant or revoke.",
			}),
		);
	return androidPermission(input.permission).pipe(
		Effect.flatMap((permission) =>
			Effect.tryPromise({
				try: () =>
					setAndroidPermission(
						serial,
						input.operation,
						permission,
						input.bundleId,
					),
				catch: commandFailure,
			}),
		),
		Effect.as({ ok: true as const }),
	);
}
