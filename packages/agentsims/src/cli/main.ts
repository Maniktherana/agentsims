#!/usr/bin/env bun
import { BunRuntime } from "@effect/platform-bun";
import { Effect } from "effect";
import { CliError } from "./error";
import { main } from "../cli/index";

BunRuntime.runMain(
	Effect.tryPromise({
		try: () => main(),
		catch: (cause) => cause,
	}).pipe(
		Effect.catchAll((error) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exitCode = error instanceof CliError ? error.exitCode : 1;
			return Effect.void;
		}),
	),
);
