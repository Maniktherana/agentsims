import { performAndroidAppAction } from "./app-tools";
import {
	performAndroidEnvironmentAction,
	androidTalkbackServices,
	readAndroidEnvironmentState,
} from "./environment-tools";
import { Context, Effect, Layer, Schema } from "effect";
import type {
	AndroidToolAction,
	AndroidToolCapabilities,
} from "../contracts";
import {
	androidShell,
	androidToolSerial,
	type AndroidToolRunner,
} from "./tool-command";

import { AndroidToolActionSchema } from "../contracts";
import {
	CommandUnavailable,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "../../tools/errors";

import { CommandExecutor } from "@effect/platform";
import { clearAndroidDeviceCaches } from "./device";
import { AndroidSessions } from "../session/session";
import { makeAndroidToolRunner } from "./tool-command";

type ToolsDependencies = {
	run: AndroidToolRunner;
	resetSession(serial: string): Effect.Effect<void, ApplicationCommandError>;
	invalidateDevice?(serial: string): void;
};
const invalid = (cause: unknown) =>
	new InvalidCommandInput({ message: String(cause), cause });
export function makeAndroidTools(dependencies: ToolsDependencies) {
	const locks = new Map<string, Effect.Semaphore>();
	function close(): void {
		locks.clear();
	}
	function serialFor(device: string) {
		return Effect.try({
			try: () => androidToolSerial(device),
			catch: commandFailure,
		});
	}
	function shell(serial: string, ...args: string[]) {
		return androidShell(dependencies.run, serial, ...args);
	}
	function lockFor(serial: string) {
		let lock = locks.get(serial);
		if (!lock) {
			if (locks.size >= 64)
				throw new CommandUnavailable({
					message: "Too many Android device tool sessions",
				});
			lock = Effect.unsafeMakeSemaphore(1);
			locks.set(serial, lock);
		}
		return lock;
	}
	function capabilities(
		device: string,
	): Effect.Effect<AndroidToolCapabilities, ApplicationCommandError> {
		return Effect.gen(function* () {
			const serial = yield* serialFor(device);
			const [qemu, sdk, features, services] = yield* Effect.all(
				[
					shell(serial, "getprop", "ro.kernel.qemu"),
					shell(serial, "getprop", "ro.build.version.sdk"),
					shell(serial, "pm", "list", "features"),
					androidTalkbackServices(dependencies.run, serial),
				],
				{ concurrency: 4 },
			);
			const emulator = qemu === "1" || /^emulator-\d+$/.test(serial);
			const apiLevel = Number.parseInt(sdk, 10) || 0;
			return {
				device: `android:${serial}`,
				emulator,
				apiLevel,
				appLocale: apiLevel >= 33,
				wifi: features.includes("android.hardware.wifi"),
				mobileData: features.includes("android.hardware.telephony"),
				airplaneMode: apiLevel >= 30,
				talkback: services.length > 0,
				telephony: emulator && features.includes("android.hardware.telephony"),
				snapshots: emulator,
				networkConditions: emulator,
				location: emulator,
			};
		});
	}
	function execute(
		device: string,
		value: unknown,
	): Effect.Effect<unknown, ApplicationCommandError> {
		return Effect.gen(function* () {
			const serial = yield* serialFor(device);
			const action = yield* Schema.decodeUnknown(AndroidToolActionSchema)(
				value,
			).pipe(Effect.mapError(invalid));
			const lock = yield* Effect.try({
				try: () => lockFor(serial),
				catch: commandFailure,
			});
			return yield* lock.withPermits(1)(perform(serial, action));
		});
	}
	function perform(
		serial: string,
		action: AndroidToolAction,
	): Effect.Effect<unknown, ApplicationCommandError> {
		switch (action.type) {
			case "apps":
			case "app":
			case "install":
			case "link":
				return performAndroidAppAction(dependencies.run, serial, action).pipe(
					Effect.tap(() =>
						Effect.sync(
							() =>
								action.type !== "apps" &&
								dependencies.invalidateDevice?.(serial),
						),
					),
				);
			default:
				return performAndroidEnvironmentAction(dependencies, serial, action);
		}
	}
	return {
		capabilities,
		state: (device: string) =>
			serialFor(device).pipe(
				Effect.flatMap((serial) =>
					readAndroidEnvironmentState(dependencies.run, serial),
				),
			),
		execute,
		close,
	};
}

export class AndroidTools extends Context.Tag("@agentsims/AndroidTools")<
	AndroidTools,
	ReturnType<typeof makeAndroidTools>
>() {}
export const AndroidToolsLive = Layer.scoped(
	AndroidTools,
	Effect.gen(function* () {
		const sessions = yield* AndroidSessions;
		const executor = yield* CommandExecutor.CommandExecutor;
		return yield* Effect.acquireRelease(
			Effect.sync(() =>
				makeAndroidTools({
					run: makeAndroidToolRunner(executor),
					invalidateDevice: clearAndroidDeviceCaches,
					resetSession: (serial) =>
						sessions.close(serial).pipe(
							Effect.tap(() =>
								Effect.sync(() => clearAndroidDeviceCaches(serial)),
							),
							Effect.mapError(commandFailure),
						),
				}),
			),
			(tools) => Effect.sync(() => tools.close()),
		);
	}),
);
