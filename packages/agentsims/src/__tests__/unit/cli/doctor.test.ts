import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { CommandExecutor } from "@effect/platform";
import {
	makeExecutor,
	ExitCode,
	type Process,
} from "@effect/platform/CommandExecutor";
import { Effect, Stream } from "effect";
import {
	checkHostTool,
	hostDiagnosticsFor,
	formatHostDiagnostics,
	resolveNativeAddonPath,
	checkRuntimeAsset,
	nativeProbeCommand,
	probeNativeAddon,
} from "../../../cli/doctor";

const bytes = (text: string) => Stream.make(new TextEncoder().encode(text));
let runtimeDist: string;

function machO(architecture = process.arch, endian: "big" | "little" = "little") {
	const buffer = Buffer.alloc(32);
	if (endian === "little") {
		buffer.writeUInt32LE(0xfeedfacf, 0);
		buffer.writeUInt32LE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4);
	} else {
		buffer.writeUInt32BE(0xfeedfacf, 0);
		buffer.writeUInt32BE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4);
	}
	return buffer;
}
beforeEach(() => {
	runtimeDist = mkdtempSync(join(tmpdir(), "agentsims doctor assets "));
	for (const name of ["agentsims", "native/agentsims-native.node", "simcam/libSimCameraInjector.dylib", "simcam/agentsims-camera-helper", "simax/agentsims-ax-settings", "android/agentsims-ax-server.jar"]) {
		const path = join(runtimeDist, name);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, name.endsWith(".jar") ? "Android bytecode fixture" : machO(), { mode: 0o755 });
	}
});
afterEach(() => rmSync(runtimeDist, { recursive: true, force: true }));

test("doctor finds the native addon beside a built CLI bundle", () => {
	const root = mkdtempSync(join(tmpdir(), "agentsims-doctor-"));
	try {
		const dist = join(root, "dist");
		const native = join(dist, "native", "agentsims-native.node");
		mkdirSync(join(dist, "native"), { recursive: true });
		writeFileSync(native, "fixture");
		expect(
			resolveNativeAddonPath(
				"agentsims-native.node",
				pathToFileURL(join(dist, "agentsims.js")).href,
				null,
			),
		).toBe(native);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("doctor reports a spawned tool with a failing exit status as unavailable", async () => {
	let released = 0;
	const executor = makeExecutor(() =>
		Effect.acquireRelease(
			Effect.succeed({
				stdout: bytes(""),
				stderr: bytes("Xcode is not selected"),
				exitCode: Effect.succeed(ExitCode(72)),
			} as unknown as Process),
			() =>
				Effect.sync(() => {
					released++;
				}),
		),
	);
	const result = await Effect.runPromise(
		checkHostTool(executor, "xcrun", ["--find", "simctl"]),
	);
	expect(result).toEqual({
		command: "xcrun",
		available: false,
		detail: "Xcode is not selected",
	});
	expect(released).toBe(1);
});

test("doctor times out and releases an owned process even if stdout remains open", async () => {
	let released = 0;
	const executor = makeExecutor(() =>
		Effect.acquireRelease(
			Effect.succeed({
				stdout: Stream.never,
				stderr: Stream.never,
				exitCode: Effect.never,
			} as unknown as Process),
			() =>
				Effect.sync(() => {
					released++;
				}),
		),
	);
	const result = await Effect.runPromise(
		checkHostTool(executor, "emulator", ["-version"], 15),
	);
	expect(result.available).toBe(false);
	expect(released).toBe(1);
});

test.each(["linux", "win32"] as const)("%s doctor skips Apple probes and does not query devices through a failing ADB", async (platform) => {
	const commands: unknown[] = [];
	const executor = makeExecutor((command) => {
		commands.push(command);
		return Effect.succeed({
			stdout: bytes(""),
			stderr: bytes("Unavailable"),
			exitCode: Effect.succeed(ExitCode(1)),
		} as unknown as Process);
	});
	const report = await Effect.runPromise(
		hostDiagnosticsFor(platform).pipe(
			Effect.provideService(CommandExecutor.CommandExecutor, executor),
		),
	);
	expect(JSON.stringify(commands)).not.toContain("devices");
	expect(JSON.stringify(commands)).not.toContain("xcrun");
	expect(JSON.stringify(commands)).not.toContain("codesign");
	expect(JSON.stringify(commands)).not.toContain("agentsims-native.node");
	expect(report.groups.map((group) => group.platform)).toEqual(["android"]);
	expect(report.ok).toBe(false);
});

function successfulExecutor() {
	return makeExecutor((command) => {
		const text = JSON.stringify(command);
		const output = text.includes('"devices"')
			? "List of devices attached\nphysical-123 device usb:1\n"
			: text.includes('"-list-avds"')
				? ""
				: "Ready";
		return Effect.succeed({
			stdout: bytes(output),
			stderr: bytes(""),
			exitCode: Effect.succeed(ExitCode(0)),
		} as unknown as Process);
	});
}
test("Android selection excludes Xcode and physical devices do not require local AVDs", async () => {
	const report = await Effect.runPromise(
		hostDiagnosticsFor("darwin", "android", { distDirectory: runtimeDist }).pipe(
			Effect.provideService(
				CommandExecutor.CommandExecutor,
				successfulExecutor(),
			),
		),
	);
	expect(report.groups.map((group) => group.platform)).toEqual(["android"]);
	expect(report.ok).toBe(true);
	expect(
		report.groups[0]?.checks.find((check) => check.id === "avds")?.status,
	).toBe("warn");
	expect(
		report.groups[0]?.checks.some((check) => check.id === "acceleration"),
	).toBe(false);
	expect(formatHostDiagnostics(report)).toContain("Create a virtual device");
	expect(formatHostDiagnostics(report)).not.toContain("WSL");
});

test("a compiled native probe uses the current executable without Node", () => {
	expect(nativeProbeCommand({ standalone: true, runtimeExecutable: "/runtime with spaces/agentsims" })).toEqual({
		command: "/runtime with spaces/agentsims", args: ["_native-addon-check"],
	});
});

test("source and uncompiled bundle probes use their existing Bun CLI entry", () => {
	const sourceMain = join(runtimeDist, "main.ts");
	writeFileSync(sourceMain, "source CLI fixture");
	expect(nativeProbeCommand({ standalone: false, moduleUrl: pathToFileURL(join(runtimeDist, "doctor.ts")).href, runtimeExecutable: "/bun" }).args).toEqual([sourceMain, "_native-addon-check"]);
	rmSync(sourceMain);
	const bundle = join(runtimeDist, "agentsims.js");
	expect(nativeProbeCommand({ standalone: false, moduleUrl: pathToFileURL(bundle).href, runtimeExecutable: "/bun" }).args).toEqual([bundle, "_native-addon-check"]);
});

test("native addon loader errors return a bounded diagnostic", () => {
	expect(probeNativeAddon(null)).toMatchObject({ available: false, detail: "The native addon is missing." });
	const result = probeNativeAddon(join(runtimeDist, "native/agentsims-native.node"));
	expect(result.available).toBe(false);
	expect(result.detail).toContain("The native addon could not load:");
	expect(result.detail.length).toBeLessThanOrEqual(4096);
});

test.each(["big", "little"] as const)("%s-endian Mach-O files accept their matching architecture and ad hoc signatures", async (endian) => {
	const path = join(runtimeDist, "native/agentsims-native.node");
	writeFileSync(path, machO("arm64", endian));
	const commands: unknown[] = [];
	const executor = makeExecutor((command) => {
		commands.push(command);
		return Effect.succeed({ stdout: bytes(""), stderr: bytes("Signature=adhoc"), exitCode: Effect.succeed(ExitCode(0)) } as unknown as Process);
	});
	const result = await Effect.runPromise(checkRuntimeAsset(executor, "native/agentsims-native.node", { distDirectory: runtimeDist, architecture: "arm64", native: true }));
	expect(result.available).toBe(true);
	expect(JSON.stringify(commands)).toContain("/usr/bin/codesign");
	expect(JSON.stringify(commands)).not.toContain("Developer ID");
	expect(JSON.stringify(commands)).not.toContain('"command":"node"');
});

test.each([20, 32])("universal Mach-O headers with %i-byte entries accept each included architecture", async (entrySize) => {
	const buffer = Buffer.alloc(8 + 2 * entrySize);
	buffer.writeUInt32BE(entrySize === 20 ? 0xcafebabe : 0xcafebabf, 0);
	buffer.writeUInt32BE(2, 4);
	buffer.writeUInt32BE(0x0100000c, 8);
	buffer.writeUInt32BE(0x01000007, 8 + entrySize);
	writeFileSync(join(runtimeDist, "native/agentsims-native.node"), buffer);
	for (const architecture of ["arm64", "x64"]) {
		const result = await Effect.runPromise(checkRuntimeAsset(successfulExecutor(), "native/agentsims-native.node", { distDirectory: runtimeDist, architecture, native: true }));
		expect(result.available).toBe(true);
	}
});

test("missing, empty, wrong-architecture, and non-executable assets produce failures", async () => {
	const check = (name: string, options = {}) => Effect.runPromise(checkRuntimeAsset(successfulExecutor(), name, { distDirectory: runtimeDist, architecture: "arm64", ...options }));
	expect(await check("missing.jar")).toMatchObject({ available: false, detail: "The runtime asset is missing: missing.jar." });
	writeFileSync(join(runtimeDist, "empty.jar"), "");
	expect(await check("empty.jar")).toMatchObject({ available: false, detail: "The runtime asset is empty or is not a file: empty.jar." });
	writeFileSync(join(runtimeDist, "wrong.node"), machO("x64"));
	expect(await check("wrong.node", { native: true })).toMatchObject({ available: false, detail: "The runtime asset does not support arm64: wrong.node." });
	writeFileSync(join(runtimeDist, "helper"), machO("arm64"), { mode: 0o644 });
	expect(await check("helper", { native: true, executable: true })).toMatchObject({ available: false, detail: "The runtime asset is not executable: helper." });
});

test("unsigned and invalid signatures produce an actionable runtime repair", async () => {
	const executor = makeExecutor(() => Effect.succeed({ stdout: bytes(""), stderr: bytes("code object is not signed at all"), exitCode: Effect.succeed(ExitCode(1)) } as unknown as Process));
	const report = await Effect.runPromise(hostDiagnosticsFor("darwin", "ios", { distDirectory: runtimeDist }).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor)));
	const capture = report.groups[0]?.checks.find((check) => check.id === "ios-native");
	expect(capture).toMatchObject({ status: "fail", repair: "Reinstall Agentsims with Homebrew or curl. In a source checkout, run bun run build." });
	expect(capture?.detail).toContain("The code signature is invalid");
	expect(capture?.detail).toContain("code object is not signed at all");
});

test("doctor uses one owned addon probe across iOS and Android and checks all native helpers", async () => {
	const commands: Array<{ command: string; args: readonly string[] }> = [];
	const executor = makeExecutor((command) => {
		if (command._tag !== "StandardCommand") throw new Error("Unexpected pipeline.");
		commands.push(command);
		const output = command.args.includes("devices") ? "List of devices attached\nemulator-5554 device\n"
			: command.args.includes("runtimes") ? '{"runtimes":[{"isAvailable":true,"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-18-0","name":"iOS 18"}]}'
			: command.args.includes("-list-avds") ? "Pixel" : "Ready";
		return Effect.succeed({ stdout: bytes(output), stderr: bytes(""), exitCode: Effect.succeed(ExitCode(0)) } as unknown as Process);
	});
	const executable = join(runtimeDist, "agentsims");
	const report = await Effect.runPromise(hostDiagnosticsFor("darwin", undefined, { distDirectory: runtimeDist, standalone: true, runtimeExecutable: executable }).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor)));
	expect(report.ok).toBe(true);
	expect(commands.filter((command) => command.args.includes("_native-addon-check"))).toEqual([expect.objectContaining({ command: executable, args: ["_native-addon-check"] })]);
	expect(commands.some((command) => command.command === "node")).toBe(false);
	const checkedAssets = commands.filter((command) => command.command === "/usr/bin/codesign").map((command) => command.args.at(-1));
	for (const file of ["agentsims", "native/agentsims-native.node", "simcam/libSimCameraInjector.dylib", "simcam/agentsims-camera-helper", "simax/agentsims-ax-settings"]) expect(checkedAssets).toContain(join(runtimeDist, file));
});

test("a failed owned addon child returns a failed check while doctor continues helper diagnostics", async () => {
	let released = 0;
	const executor = makeExecutor((command) => Effect.acquireRelease(Effect.succeed({
		stdout: bytes(JSON.stringify(command).includes('"runtimes"') ? '{"runtimes":[{"isAvailable":true,"identifier":"com.apple.CoreSimulator.SimRuntime.iOS-18-0","name":"iOS 18"}]}' : "Ready"),
		stderr: bytes(JSON.stringify(command).includes("_native-addon-check") ? "Native loader terminated" : ""),
		exitCode: Effect.succeed(ExitCode(JSON.stringify(command).includes("_native-addon-check") ? 139 : 0)),
	} as unknown as Process), () => Effect.sync(() => { released++; })));
	const report = await Effect.runPromise(hostDiagnosticsFor("darwin", "ios", { distDirectory: runtimeDist, standalone: true }).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor)));
	expect(report.ok).toBe(false);
	expect(report.groups[0]?.checks.find((check) => check.id === "ios-native")).toMatchObject({ status: "fail", detail: "Native loader terminated" });
	expect(report.groups[0]?.checks.find((check) => check.id === "camera-helper")?.status).toBe("pass");
	expect(released).toBeGreaterThan(0);
});
test.each(["linux", "win32"] as const)("an explicitly requested iOS workflow fails on %s without host probes", async (platform) => {
	const commands: unknown[] = [];
	const executor = makeExecutor((command) => {
		commands.push(command);
		return Effect.die("An unavailable iOS workflow must not probe a host tool.");
	});
	const report = await Effect.runPromise(
		hostDiagnosticsFor(platform, "ios").pipe(
			Effect.provideService(
				CommandExecutor.CommandExecutor,
				executor,
			),
		),
	);
	expect(report.ok).toBe(false);
	expect(commands).toEqual([]);
	expect(report.groups[0]?.checks[0]).toMatchObject({
		id: "host",
		status: "fail",
		repair: "Run this workflow on a Mac with Xcode installed.",
	});
});
test("an empty iOS runtime inventory is a blocking setup issue", async () => {
	const executor = makeExecutor((command) =>
		Effect.succeed({
			stdout: bytes(
				JSON.stringify(command).includes('"runtimes"')
					? '{"runtimes":[]}'
					: "Ready",
			),
			stderr: bytes(""),
			exitCode: Effect.succeed(ExitCode(0)),
		} as unknown as Process),
	);
	const report = await Effect.runPromise(
		hostDiagnosticsFor("darwin", "ios").pipe(
			Effect.provideService(CommandExecutor.CommandExecutor, executor),
		),
	);
	expect(report.ok).toBe(false);
	expect(
		report.groups[0]?.checks.find((check) => check.id === "ios-runtime")
			?.status,
	).toBe("fail");
	expect(formatHostDiagnostics(report)).toContain(
		"install an iOS Simulator runtime",
	);
});
