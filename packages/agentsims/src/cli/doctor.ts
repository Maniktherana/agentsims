import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredDistDirectory } from "../core/native-paths";
import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";
import { captureHostCommand } from "../core/host";
import { androidTool } from "../core/android/device/sdk-tools";
import { hostPlatformInfo } from "../core/host";

type ToolCheck = { command: string; available: boolean; detail: string };

/** Probe the exit status as well as output. A spawned tool can still be unusable. */
export function checkHostTool(
	executor: CommandExecutor.CommandExecutor,
	command: string,
	args: readonly string[],
	timeoutMs = 5000,
	outputLimit = 4096,
): Effect.Effect<ToolCheck> {
	return captureHostCommand(executor, Command.make(command, ...args), {
		stdoutLimit: outputLimit,
		stderrLimit: 4096,
		truncate: true,
		timeoutMs,
	}).pipe(
		Effect.map(({ stdout, stderr, exitCode }) => {
			return {
				command,
				available: exitCode === 0,
				detail: (exitCode === 0
					? stdout.trim() || stderr.trim()
					: stderr.trim() || stdout.trim() || `Exited with status ${exitCode}`
				).slice(0, outputLimit),
			};
		}),
		Effect.catchAll((error) =>
			Effect.succeed({
				command,
				available: false,
				detail: String(error).slice(0, 500),
			}),
		),
	);
}

export type DoctorPlatform = "android" | "ios";
type DiagnosticCheck = {
	id: string;
	label: string;
	status: "pass" | "warn" | "fail";
	detail: string;
	repair?: string;
};

export function hostDiagnosticsFor(
	platform: NodeJS.Platform = process.platform,
	target?: DoctorPlatform,
) {
	return Effect.gen(function* () {
		const executor = yield* CommandExecutor.CommandExecutor;
		const check = (command: string, args: string[]) =>
			checkHostTool(executor, command, args);
		const nativeAddon = (name: string) => {
			const dist =
				configuredDistDirectory() ??
				resolve(dirname(fileURLToPath(import.meta.url)), "../../dist");
			const path = resolve(dist, "native", name);
			if (!existsSync(path))
				return Effect.succeed({
					command: path,
					available: false,
					detail: `Missing ${name}`,
				});
			return check(process.env.npm_node_execpath ?? "node", [
				"-e",
				`require(${JSON.stringify(path)}); console.log("Native module loads")`,
			]);
		};
		const capabilities = hostPlatformInfo(platform);
		const selected = target ? [target] : capabilities.platforms;
		const groups: { platform: string; checks: DiagnosticCheck[] }[] = [];
		for (const workflow of selected) {
			const checks: DiagnosticCheck[] = [];
			groups.push({ platform: workflow, checks });
			const add = (
				id: string,
				label: string,
				result: ToolCheck,
				repair: string,
				required = true,
			) =>
				checks.push({
					id,
					label,
					status: result.available ? "pass" : required ? "fail" : "warn",
					detail: result.detail,
					...(!result.available ? { repair } : {}),
				});
			if (workflow === "android") {
				const adb = androidTool("adb", { platform });
				const emulator = androidTool("emulator", { platform });
				const adbVersion = yield* check(adb, ["version"]);
				add(
					"adb",
					"Android platform-tools",
					adbVersion,
					"Install Android SDK Platform-Tools in Android Studio > SDK Manager. Set ANDROID_HOME to the SDK directory, or AGENTSIMS_ADB to adb.",
				);
				const devices = adbVersion.available
					? yield* check(adb, ["devices", "-l"])
					: null;
				const connected =
					devices?.detail
						.split(/\r?\n/)
						.filter((line) => /^\S+\s+device(?:\s|$)/.test(line)) ?? [];
				const physical = connected.some(
					(line) => !line.startsWith("emulator-"),
				);
				if (devices)
					add(
						"devices",
						"Device connection",
						{
							...devices,
							available: devices.available && connected.length > 0,
							detail: devices.available
								? connected.length
									? connected.join("; ")
									: "No authorized connected devices"
								: devices.detail,
						},
						devices.available
							? "Start an AVD in Android Studio > Device Manager, or connect a device and approve USB debugging. Run adb devices -l to check authorization."
							: "Run adb devices -l and fix the reported ADB connection error.",
						!devices.available,
					);
				const emulatorVersion = yield* check(emulator, ["-version"]);
				add(
					"emulator",
					"Android Emulator",
					emulatorVersion,
					"Install Android Emulator and an Android system image in Android Studio > SDK Manager.",
					!physical,
				);
				if (emulatorVersion.available) {
					const avds = yield* check(emulator, ["-list-avds"]);
					const names = avds.available
						? avds.detail.split(/\r?\n/).filter(Boolean)
						: [];
					add(
						"avds",
						"Local virtual devices",
						{ ...avds, available: avds.available && names.length > 0 },
						"Create a virtual device in Android Studio > Device Manager. Start it before opening Agentsims.",
						false,
					);
					if (names.length > 0 && !physical) {
						const acceleration = yield* check(emulator, ["-accel-check"]);
						add(
							"acceleration",
							"Emulator acceleration",
							acceleration,
							platform === "linux"
								? "Enable CPU virtualization and KVM. Check that your account can read and write /dev/kvm."
								: "Check hardware virtualization support and update Android Emulator in SDK Manager.",
						);
					}
				}
				if (
					platform === "darwin" &&
					(!physical || connected.some((line) => line.startsWith("emulator-")))
				) {
					add(
						"android-native",
						"Android capture module",
						yield* nativeAddon("agentsims-native.node"),
						"Reinstall the matching Agentsims runtime package. In a source checkout, run bun run build.",
					);
				}
			} else {
				if (platform !== "darwin") {
					checks.push({
						id: "host",
						label: "iOS Simulator host",
						status: "fail",
						detail: "iOS Simulator requires macOS.",
						repair: "Run this workflow on a Mac with Xcode installed.",
					});
					continue;
				}
				const xcode = yield* check("xcrun", ["--find", "simctl"]);
				add(
					"xcode",
					"Xcode Simulator tools",
					xcode,
					"Install Xcode, open it to finish setup, then run sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer.",
				);
				if (xcode.available) {
					const runtimes = yield* checkHostTool(
						executor,
						"xcrun",
						["simctl", "list", "runtimes", "-j"],
						5000,
						1024 * 1024,
					);
					let names: string[] = [];
					try {
						names = JSON.parse(runtimes.detail)
							.runtimes.filter(
								(runtime: { isAvailable?: boolean; identifier?: string }) =>
									runtime.isAvailable &&
									/SimRuntime\.iOS-/.test(runtime.identifier ?? ""),
							)
							.map((runtime: { name: string }) => runtime.name);
					} catch {
						/* Invalid tool output is an unavailable runtime check. */
					}
					add(
						"ios-runtime",
						"Installed iOS runtime",
						{
							...runtimes,
							available: runtimes.available && names.length > 0,
							detail: names.join(", ") || runtimes.detail,
						},
						"Open Xcode > Settings > Components and install an iOS Simulator runtime.",
					);
				}
				add(
					"ios-native",
					"iOS capture module",
					yield* nativeAddon("agentsims-native.node"),
					"Reinstall the matching Agentsims runtime package. In a source checkout, run bun run build.",
				);
			}
		}
		return {
			platform,
			architecture: process.arch,
			groups,
			ok:
				groups.length > 0 &&
				groups.every((group) =>
					group.checks.every((check) => check.status !== "fail"),
				),
		};
	});
}

export function formatHostDiagnostics(report: {
	ok: boolean;
	groups: { platform: string; checks: DiagnosticCheck[] }[];
}): string {
	return [
		...report.groups.flatMap((group) => [
			group.platform === "ios" ? "iOS" : "Android",
			...group.checks.flatMap((check) => [
				`  ${check.status === "pass" ? "PASS" : check.status === "warn" ? "WARN" : "FAIL"} ${check.label}: ${check.detail.split(/\r?\n/)[0] || "No output"}`,
				...(check.repair ? [`       Fix: ${check.repair}`] : []),
			]),
			"",
		]),
		report.ok
			? "Dependencies ready for the selected workflow."
			: "Fix the failed checks, then run agentsims doctor again.",
	].join("\n");
}
