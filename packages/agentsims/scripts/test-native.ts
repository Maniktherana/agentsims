#!/usr/bin/env bun
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

function requiredEnvironment(name: string): string {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`Set ${name} before the native test.`);
	return value;
}

function output(command: string, args: string[]): string {
	const result = spawnSync(command, args, {
		cwd: root,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`${command} ${args.join(" ")} failed (${result.signal ?? result.status}).\n${result.stdout}${result.stderr}`,
		);
	return result.stdout.trim();
}

function run(args: string[], environment: NodeJS.ProcessEnv): void {
	const result = spawnSync(process.execPath, args, {
		cwd: root,
		env: environment,
		stdio: "inherit",
	});
	if (result.error) throw result.error;
	if (result.status !== 0)
		throw new Error(
			`bun ${args.join(" ")} failed (${result.signal ?? result.status}).`,
		);
}

function requireArtifact(path: string): void {
	let size = 0;
	try {
		size = statSync(path).size;
	} catch {
		throw new Error(`The native artifact is missing: ${path}. Run the build.`);
	}
	if (size === 0) throw new Error(`The native artifact is empty: ${path}.`);
}

if (process.platform !== "darwin")
	throw new Error("The native test requires macOS.");

const iosDevice = requiredEnvironment("AGENTSIMS_E2E_IOS_DEVICE");
const androidEmulator = requiredEnvironment("AGENTSIMS_E2E_ANDROID_EMULATOR");
const androidPhysical = requiredEnvironment(
	"AGENTSIMS_E2E_ANDROID_PHYSICAL_DEVICE",
);
if (androidEmulator === androidPhysical)
	throw new Error("Use different IDs for the Android emulator and device.");

for (const artifact of [
	"dist/native/agentsims-native.node",
	"dist/android/agentsims-ax-server.jar",
	"dist/simcam/libSimCameraInjector.dylib",
	"dist/simcam/agentsims-camera-helper",
	"dist/simax/agentsims-ax-settings",
])
	requireArtifact(resolve(root, artifact));

const simulators = JSON.parse(
	output("xcrun", ["simctl", "list", "devices", "--json"]),
) as { devices?: Record<string, Array<{ udid?: string; state?: string }>> };
const simulator = Object.values(simulators.devices ?? {})
	.flat()
	.find((device) => device.udid === iosDevice);
if (!simulator)
	throw new Error(`The iOS simulator is not installed: ${iosDevice}.`);
if (simulator.state !== "Booted")
	throw new Error(
		`Boot the iOS simulator before the native test: ${iosDevice}.`,
	);

function requireAndroid(device: string, kind: "emulator" | "physical"): void {
	if (output("adb", ["-s", device, "get-state"]) !== "device")
		throw new Error(`The Android ${kind} is not ready: ${device}.`);
	const qemu = output("adb", [
		"-s",
		device,
		"shell",
		"getprop",
		"ro.kernel.qemu",
	]);
	if (kind === "emulator" && qemu !== "1")
		throw new Error(`The Android emulator ID is not an emulator: ${device}.`);
	if (kind === "physical" && qemu === "1")
		throw new Error(`The physical Android ID is an emulator: ${device}.`);
}

requireAndroid(androidEmulator, "emulator");
requireAndroid(androidPhysical, "physical");

const baseEnvironment = { ...process.env };
run(
	[
		"test",
		"src/__tests__/e2e",
		"src/__tests__/integration/android-videotoolbox.test.ts",
	],
	{
		...baseEnvironment,
		AGENTSIMS_E2E_IOS_DEVICE: iosDevice,
		AGENTSIMS_E2E_ANDROID_DEVICE: androidEmulator,
		AGENTSIMS_E2E_IOS_ASSETS: "1",
		AGENTSIMS_E2E_SHM: "1",
	},
);
run(["test", "src/__tests__/e2e/type-command-sim.e2e.test.ts"], {
	...baseEnvironment,
	AGENTSIMS_E2E_IOS_DEVICE: "",
	AGENTSIMS_E2E_ANDROID_DEVICE: androidPhysical,
	AGENTSIMS_E2E_IOS_ASSETS: "0",
	AGENTSIMS_E2E_SHM: "0",
});

process.stdout.write(
	"Native tests passed for the iOS simulator, Android emulator, and physical Android device.\n",
);
