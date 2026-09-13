#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { CliError } from "./error";
import { dirname } from "node:path";
import { configureDistDirectory } from "../core/native-paths";

declare const __AGENTSIMS_STANDALONE__: boolean;
if (
	typeof __AGENTSIMS_STANDALONE__ !== "undefined" &&
	__AGENTSIMS_STANDALONE__
) {
	configureDistDirectory(dirname(process.execPath));
}

BunRuntime.runMain(
	Effect.tryPromise({
		try: async () => {
			const { main } = await import("./index");
			return main();
		},
		catch: (cause) => cause,
	}).pipe(
		Effect.catchAll((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = error instanceof CliError ? error.exitCode : 1;
			return Effect.void;
		}),
	),
);
