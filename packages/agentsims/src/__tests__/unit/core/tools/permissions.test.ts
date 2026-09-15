import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
	AndroidPackageSchema,
	BundleIdSchema,
	PermissionMutationSchema,
	PermissionOperations,
	PermissionOperationsLive,
} from "../../../../core/tools/permissions";

describe("permission operations", () => {
	test("accepts only bounded permission mutations", () => {
		expect(
			PermissionMutationSchema.parse({
				operation: "grant",
				bundleId: "com.example.app",
				permission: "location",
				value: "always",
			}),
		).toEqual({
			operation: "grant",
			bundleId: "com.example.app",
			permission: "location",
			value: "always",
		});
		expect(
			PermissionMutationSchema.safeParse({
				operation: "shell",
				bundleId: "com.example.app",
				permission: "camera",
			}).success,
		).toBe(false);
		expect(
			PermissionMutationSchema.safeParse({
				operation: "grant",
				bundleId: "com.example.app",
				permission: "",
			}).success,
		).toBe(false);
		expect(
			PermissionMutationSchema.safeParse({
				operation: "grant",
				bundleId: "not a package",
				permission: "camera",
			}).success,
		).toBe(false);
	});

	// The permission name belongs to the platform that owns the device, so the
	// shared schema carries a string and each branch validates it.
	test("carries an Android runtime permission name through the schema", () => {
		expect(
			PermissionMutationSchema.parse({
				operation: "revoke",
				bundleId: "com.my_app.thing",
				permission: "android.permission.CAMERA",
			}),
		).toEqual({
			operation: "revoke",
			bundleId: "com.my_app.thing",
			permission: "android.permission.CAMERA",
		});
	});

	test("separates Android package names from iOS bundle identifiers", () => {
		expect(AndroidPackageSchema.safeParse("com.my_app.thing").success).toBe(true);
		expect(BundleIdSchema.safeParse("com.my_app.thing").success).toBe(false);
		expect(BundleIdSchema.safeParse("com.example.app").success).toBe(true);
		expect(AndroidPackageSchema.safeParse("com.example.app").success).toBe(true);
		expect(AndroidPackageSchema.safeParse("nodots").success).toBe(false);
	});

	test("requires a package name for an Android device", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				return yield* (yield* PermissionOperations).list(
					"android:emulator-5554",
				);
			}).pipe(Effect.provide(PermissionOperationsLive)),
		);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure")
			expect(String(exit.cause)).toContain(
				"Android permission operations require an app package name.",
			);
	});

	test("rejects an iOS-only value on Android", async () => {
		const run = (input: Parameters<
			(typeof PermissionOperations)["Service"]["mutate"]
		>[1]) =>
			Effect.runPromiseExit(
				Effect.gen(function* () {
					return yield* (yield* PermissionOperations).mutate(
						"android:emulator-5554",
						input,
					);
				}).pipe(Effect.provide(PermissionOperationsLive)),
			);

		const withValue = await run({
			operation: "grant",
			bundleId: "com.example.app",
			permission: "android.permission.CAMERA",
			value: "always",
		});
		expect(withValue._tag).toBe("Failure");
		if (withValue._tag === "Failure")
			expect(String(withValue.cause)).toContain(
				"Android permissions have no value.",
			);
	});
});
