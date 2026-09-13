import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";
import { captureHostCommand } from "../../host";
import { androidTool } from "./sdk-tools";
import {
	CommandFailure,
	InvalidCommandInput,
	commandFailure,
	type ApplicationCommandError,
} from "../../tools/errors";

export function androidToolSerial(device: string): string {
	const serial = device.startsWith("android:") ? device.slice(8) : device;
	if (!serial || !/^[A-Za-z0-9_.:[\]-]+$/.test(serial))
		throw new InvalidCommandInput({
			message: "Specify an Android device serial",
		});
	return serial;
}

/** adb joins shell arguments again on the device. Quote each argument there too. */
export function androidShellArgument(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

export type AndroidToolRunner = (
	serial: string,
	args: readonly string[],
	timeoutMs?: number,
) => Effect.Effect<string, ApplicationCommandError>;
export const makeAndroidToolRunner =
	(executor: CommandExecutor.CommandExecutor): AndroidToolRunner =>
	(serial, args, timeoutMs = 15000) =>
		Effect.gen(function* () {
			const {
				stdout: out,
				stderr: err,
				exitCode: code,
			} = yield* captureHostCommand(
				executor,
				Command.make(androidTool("adb"), "-s", serial, ...args),
				{ truncate: true },
			);
			if (
				code !== 0 ||
				/^(?:Failure\b|Error(?:\s+type\b|:)|KO:|Security exception:|Exception occurred)/m.test(
					out,
				)
			)
				return yield* Effect.fail(
					new CommandFailure({
						message: (
							err.trim() ||
							out.trim() ||
							`ADB exited with ${code}`
						).slice(0, 4096),
					}),
				);
			return out.trim();
		}).pipe(
			Effect.timeoutFail({
				duration: timeoutMs,
				onTimeout: () =>
					new CommandFailure({
						message: `Android command exceeded ${timeoutMs} ms`,
					}),
			}),
			Effect.mapError(commandFailure),
		);

export const androidShell = (
	run: AndroidToolRunner,
	serial: string,
	...args: string[]
) => run(serial, ["shell", args.map(androidShellArgument).join(" ")]);
