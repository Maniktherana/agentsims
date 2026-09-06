import { Effect } from "effect";
import type { AndroidToolAction } from "../contracts";
import { androidShell, type AndroidToolRunner } from "./tool-command";
import {
	CommandUnavailable,
	InvalidCommandInput,
	type ApplicationCommandError,
} from "../../shared/application-errors";

type AppAction = Extract<
	AndroidToolAction,
	{ type: "apps" | "app" | "install" | "link" }
>;
export function performAndroidAppAction(
	run: AndroidToolRunner,
	serial: string,
	action: AppAction,
): Effect.Effect<unknown, ApplicationCommandError> {
	const shell = (...args: string[]) => androidShell(run, serial, ...args);
	return Effect.gen(function* () {
		switch (action.type) {
			case "apps": {
				const [output, systemOutput] = yield* Effect.all(
					[
						shell("pm", "list", "packages"),
						shell("pm", "list", "packages", "-s"),
					],
					{ concurrency: 2 },
				);
				const packages = output
					.split(/\r?\n/)
					.filter((line) => line.startsWith("package:"))
					.map((line) => line.slice(8))
					.sort();
				const system = new Set(
					systemOutput
						.split(/\r?\n/)
						.filter((line) => line.startsWith("package:"))
						.map((line) => line.slice(8)),
				);
				return {
					packages,
					apps: packages.map((name) => ({
						package: name,
						system: system.has(name),
					})),
				};
			}
			case "app": {
				let output: string;
				if (action.operation === "launch") {
					const resolved = yield* shell(
						"cmd",
						"package",
						"resolve-activity",
						"--brief",
						"-a",
						"android.intent.action.MAIN",
						"-c",
						"android.intent.category.LAUNCHER",
						action.package,
					);
					const component = resolved
						.split(/\r?\n/)
						.find((line) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+$/.test(line));
					if (!component)
						return yield* Effect.fail(
							new CommandUnavailable({
								message: "This package has no launcher activity",
							}),
						);
					output = yield* shell("am", "start", "-W", "-n", component);
				} else if (action.operation === "stop")
					output = yield* shell("am", "force-stop", action.package);
				else if (action.operation === "clear")
					output = yield* shell("pm", "clear", action.package);
				else output = yield* run(serial, ["uninstall", action.package]);
				return {
					operation: action.operation,
					package: action.package,
					output,
				};
			}
			case "install": {
				if (!action.path.toLowerCase().endsWith(".apk"))
					return yield* Effect.fail(
						new InvalidCommandInput({
							message: "Install requires an APK file",
						}),
					);
				return {
					output: yield* run(serial, ["install", "-r", action.path], 180000),
				};
			}
			case "link":
				return {
					output: yield* shell(
						"am",
						"start",
						"-W",
						"-a",
						"android.intent.action.VIEW",
						"-d",
						action.url,
						...(action.package ? ["-p", action.package] : []),
					),
				};
		}
	});
}
