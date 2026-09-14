import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
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
				permission: "arbitrary-service",
			}).success,
		).toBe(false);
	});

	test("rejects Android explicitly without executing a host operation", async () => {
		const exit = await Effect.runPromiseExit(
			Effect.gen(function* () {
				return yield* (yield* PermissionOperations).list(
					"android:emulator-5554",
					"com.example.app",
				);
			}).pipe(Effect.provide(PermissionOperationsLive)),
		);
		expect(exit._tag).toBe("Failure");
		if (exit._tag === "Failure")
			expect(String(exit.cause)).toContain(
				"Android permission operations are not supported.",
			);
	});
});
