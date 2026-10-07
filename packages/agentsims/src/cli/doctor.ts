import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configuredDistDirectory } from "../core/native-paths";
import { Command, CommandExecutor } from "@effect/platform";
import { Effect } from "effect";
import { captureHostCommand } from "../core/host";
import { androidTool } from "../core/android/device/sdk-tools";
import { hostPlatformInfo } from "../core/host";

type ToolCheck = { command: string; available: boolean; detail: string };
declare const __AGENTSIMS_STANDALONE__: boolean;

type DoctorRuntimeOptions = {
	distDirectory?: string | null;
	moduleUrl?: string;
	runtimeExecutable?: string;
	standalone?: boolean;
	architecture?: string;
};
const runtimeRepair = "Reinstall Agentsims with Homebrew or curl. In a source checkout, run bun run build.";

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

export function resolveNativeAddonPath(
	name: string,
	moduleUrl = import.meta.url,
	dist = configuredDistDirectory(),
): string | null {
	return resolveRuntimeAssetPath(`native/${name}`, moduleUrl, dist);
}

function resolveRuntimeAssetPath(
	name: string,
	moduleUrl = import.meta.url,
	dist = configuredDistDirectory(),
): string | null {
	const moduleDirectory = dirname(fileURLToPath(moduleUrl));
	const roots = dist
		? [dist]
		: [moduleDirectory, resolve(moduleDirectory, "../../dist")];
	for (const root of roots) {
		const candidate = resolve(root, name);
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

/** This runs only in an owned child, so addon loader failures cannot stop doctor. */
export function probeNativeAddon(path = resolveNativeAddonPath("agentsims-native.node")): ToolCheck {
	if (!path) return { command: "agentsims-native.node", available: false, detail: "The native addon is missing." };
	try {
		createRequire(import.meta.url)(path);
		return { command: path, available: true, detail: "The native addon loads in Agentsims." };
	} catch (error) {
		return { command: path, available: false, detail: `The native addon could not load: ${error instanceof Error ? error.message : String(error)}`.slice(0, 4096) };
	}
}

export function nativeProbeCommand(options: DoctorRuntimeOptions = {}) {
	const standalone = options.standalone ?? (typeof __AGENTSIMS_STANDALONE__ !== "undefined" && __AGENTSIMS_STANDALONE__);
	const moduleFile = fileURLToPath(options.moduleUrl ?? import.meta.url);
	const sourceMain = resolve(dirname(moduleFile), "main.ts");
	return {
		command: options.runtimeExecutable ?? process.execPath,
		args: [...(standalone ? [] : [existsSync(sourceMain) ? sourceMain : moduleFile]), "_native-addon-check"],
	};
}

function supportsMachOArchitecture(path: string, architecture: string): boolean {
	const cpu = architecture === "arm64" ? 0x0100000c : architecture === "x64" ? 0x01000007 : null;
	if (cpu === null) return false;
	const descriptor = openSync(path, "r");
	try {
		const buffer = Buffer.alloc(8 + 64 * 32);
		const size = readSync(descriptor, buffer, 0, buffer.length, 0);
		if (size < 8) return false;
		const magic = buffer.readUInt32BE(0);
		if (magic === 0xfeedfacf || magic === 0xcffaedfe) {
			return (magic === 0xfeedfacf ? buffer.readUInt32BE(4) : buffer.readUInt32LE(4)) === cpu;
		}
		const littleEndian = magic === 0xbebafeca || magic === 0xbfbafeca;
		const entrySize = magic === 0xcafebabf || magic === 0xbfbafeca ? 32 : 20;
		if (![0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) return false;
		const readInteger = (offset: number) => littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
		const count = readInteger(4);
		if (count === 0 || count > 64 || size < 8 + count * entrySize) return false;
		for (let index = 0; index < count; index++) {
			if (readInteger(8 + index * entrySize) === cpu) return true;
		}
		return false;
	} finally {
		closeSync(descriptor);
	}
}

export function checkRuntimeAsset(
	executor: CommandExecutor.CommandExecutor,
	name: string,
	options: DoctorRuntimeOptions & { native?: boolean; executable?: boolean } = {},
): Effect.Effect<ToolCheck> {
	return Effect.gen(function* () {
		const path = resolveRuntimeAssetPath(name, options.moduleUrl, options.distDirectory);
		if (!path) return { command: name, available: false, detail: `The runtime asset is missing: ${name}.` };
		try {
			const stat = statSync(path);
			if (!stat.isFile() || stat.size === 0) return { command: path, available: false, detail: `The runtime asset is empty or is not a file: ${name}.` };
			if (options.executable && (stat.mode & 0o111) === 0) return { command: path, available: false, detail: `The runtime asset is not executable: ${name}.` };
			if (options.native && !supportsMachOArchitecture(path, options.architecture ?? process.arch)) {
				return { command: path, available: false, detail: `The runtime asset does not support ${options.architecture ?? process.arch}: ${name}.` };
			}
		} catch (error) {
			return { command: path, available: false, detail: `The runtime asset could not be read: ${error instanceof Error ? error.message : String(error)}` };
		}
		if (options.native) {
			const signature = yield* checkHostTool(executor, "/usr/bin/codesign", ["--verify", "--strict", path]);
			if (!signature.available) return { ...signature, command: path, detail: `The code signature is invalid for ${name}: ${signature.detail}` };
			return { command: path, available: true, detail: `Valid code signature and architecture: ${name}.` };
		}
		return { command: path, available: true, detail: `Runtime asset ready: ${name}.` };
	});
}

export function hostDiagnosticsFor(
	platform: NodeJS.Platform = process.platform,
	target?: DoctorPlatform,
	options: DoctorRuntimeOptions = {},
) {
	return Effect.gen(function* () {
		const executor = yield* CommandExecutor.CommandExecutor;
		const check = (command: string, args: string[]) =>
			checkHostTool(executor, command, args);
		const nativeAddon = Effect.gen(function* () {
			const asset = yield* checkRuntimeAsset(executor, "native/agentsims-native.node", { ...options, native: true });
			if (!asset.available) return asset;
			const probe = nativeProbeCommand(options);
			return yield* check(probe.command, probe.args);
		}).pipe(Effect.cached);
		const loadNativeAddon = yield* nativeAddon;
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
				add("android-ax", "Android accessibility runtime", yield* checkRuntimeAsset(executor, "android/agentsims-ax-server.jar", options), runtimeRepair);
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
						yield* loadNativeAddon,
						runtimeRepair,
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
					yield* loadNativeAddon,
					runtimeRepair,
				);
				for (const [id, label, name, executable] of [
					["camera-injector", "iOS camera injector", "simcam/libSimCameraInjector.dylib", false],
					["camera-helper", "iOS camera helper", "simcam/agentsims-camera-helper", true],
					["ax-settings", "iOS accessibility helper", "simax/agentsims-ax-settings", true],
				] as const) {
					add(id, label, yield* checkRuntimeAsset(executor, name, { ...options, native: true, executable }), runtimeRepair);
				}
			}
			if (platform === "darwin" && (options.standalone ?? (typeof __AGENTSIMS_STANDALONE__ !== "undefined" && __AGENTSIMS_STANDALONE__))) {
				add("runtime-signature", "Agentsims executable", yield* checkRuntimeAsset(executor, "agentsims", { ...options, native: true, executable: true }), runtimeRepair);
			}
		}
		return {
			platform,
			architecture: options.architecture ?? process.arch,
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
