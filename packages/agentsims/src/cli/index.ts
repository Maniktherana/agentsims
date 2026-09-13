#!/usr/bin/env bun
import {
	cameraHelperFiles,
	readInjectedBundles,
	locateCameraHelper,
	buildCameraHelper,
	sendHelperCommand,
	attachCamera,
	isHelperAlive,
	stopExistingHelper,
	detectMediaKind,
} from "../core/ios/camera-helper";
import { registerAndroidCommands } from "./android-commands";
import { Command, InvalidArgumentError } from "commander";
import { Effect } from "effect";
import { spawn as nodeSpawn, type ChildProcess } from "child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readFileSync,
	writeFileSync,
	rmSync,
} from "fs";
import { randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { join, resolve } from "path";
import { resolveAppConfig } from "./app-config";
import {
	STATE_DIR,
	stateFileForDevice,
	listStateFiles,
	inProcessDeviceState,
} from "../core/tools/devices/state";
import { servePreview, type PreviewServer } from "../server/http/server";
import {
	configuredDistDirectory,
	dirnameOf,
} from "../core/native-paths";
import { killPortHolder, isPortFree } from "../server/runtime/ports";
import { hostCommandText } from "../core/host";
import {
	findBootedDevice,
	resolveDevice,
	listIosDevices,
} from "../core/ios/devices";
import {
	androidSerialFromStateId,
	androidStateId,
	listAndroidDevices,
} from "../core/android/device/device";
import { permissions } from "../core/ios/permissions";
import { uiSettings } from "../core/ios/settings";
import { debugCli, debugHelper, debugState } from "../core/logging";
import { readAllStates, readState, type ServerState } from "./device-state";
import { addCompatibilityCommands, DEVICE_OPTION } from "./device-control";
import { addSetupCommand } from "./setup-command";
import { addWorkspaceCommands } from "./workspace-commands";
import { CliError } from "./error";

// `import.meta.dir` is Bun-only; resolve once via fileURLToPath so the bundled
// CLI works under plain `node` too.
const __dirname = dirnameOf(import.meta.url);

// Stamped in by build.ts. Source execution falls back to the package.json
// beside this module.
declare const __AGENTSIMS_VERSION__: string | undefined;
function resolveVersion(): string {
	if (typeof __AGENTSIMS_VERSION__ === "string") return __AGENTSIMS_VERSION__;
	try {
		const packagePath = [
			join(__dirname, "..", "package.json"),
			join(__dirname, "..", "..", "package.json"),
		].find((candidate) => existsSync(candidate));
		if (!packagePath) return "0.0.0";
		const pkg = JSON.parse(readFileSync(packagePath, "utf-8"));
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

function environmentAppConfig() {
	try {
		return Effect.runSync(resolveAppConfig({}, process.env));
	} catch (error) {
		throw new InvalidArgumentError(
			error instanceof Error ? error.message : String(error),
		);
	}
}

function previewPortFromEnvironment(): number | undefined {
	return process.env.PORT?.trim() ? environmentAppConfig().port : undefined;
}

function previewHostFromEnvironment(): string {
	return environmentAppConfig().host;
}

function previewRootForRuntime(): string {
	const configured = configuredDistDirectory();
	if (configured) return resolve(configured, "preview");
	const installed = resolve(__dirname, "preview");
	if (existsSync(resolve(installed, "index.html"))) return installed;
	return resolve(__dirname, "..", "..", "dist", "preview");
}

function ensureStateDir() {
	if (!existsSync(STATE_DIR)) {
		mkdirSync(STATE_DIR, { recursive: true });
	}
}

function writeState(state: ServerState) {
	ensureStateDir();
	writeFileSync(
		stateFileForDevice(state.device),
		JSON.stringify(state, null, 2),
	);
	debugState(
		"wrote state pid=%d device=%s port=%d",
		state.pid,
		state.device,
		state.port,
	);
}

function clearState(udid?: string) {
	if (udid) {
		debugState("clearState device=%s", udid);
		rmSync(stateFileForDevice(udid), { force: true });
		return;
	}
	debugState("clearState (all)");
	for (const file of listStateFiles()) rmSync(file, { force: true });
}

// ─── Device helpers ───

/**
 * Pick a sensible default device to boot when the user runs `agentsims` with
 * no booted simulator. Prefers an available iPhone on the newest iOS runtime.
 */
async function pickDefaultDevice(): Promise<{
	udid: string;
	name: string;
} | null> {
	const devices = await listIosDevices();
	if (!devices) return null;
	try {
		const iosRuntimes = Object.keys(devices)
			.filter((runtime) => /SimRuntime\.iOS-/i.test(runtime))
			.sort((left, right) => {
				const leftVersion = (left.match(/iOS-(\d+)-(\d+)/) ?? [])
					.slice(1)
					.map(Number);
				const rightVersion = (right.match(/iOS-(\d+)-(\d+)/) ?? [])
					.slice(1)
					.map(Number);
				return (
					(rightVersion[0] ?? 0) - (leftVersion[0] ?? 0) ||
					(rightVersion[1] ?? 0) - (leftVersion[1] ?? 0)
				);
			});
		for (const runtime of iosRuntimes) {
			const iphone = (devices[runtime] ?? []).find(
				(device) =>
					device.isAvailable !== false && /^iPhone\b/i.test(device.name),
			);
			if (iphone) return { udid: iphone.udid, name: iphone.name };
		}
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	return null;
}

async function getDeviceName(udid: string): Promise<string | null> {
	const devices = await listIosDevices();
	return (
		Object.values(devices ?? {})
			.flat()
			.find((device) => device.udid === udid)?.name ?? null
	);
}

async function isDeviceBooted(udid: string): Promise<boolean> {
	const devices = await listIosDevices();
	return Object.values(devices ?? {})
		.flat()
		.some((device) => device.udid === udid && device.state === "Booted");
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** Kill a process and wait for it to actually exit. */
async function stopProcess(pid: number): Promise<void> {
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	const exited = async (deadline: number) => {
		while (Date.now() < deadline) {
			if (!isProcessAlive(pid)) return true;
			await Effect.runPromise(Effect.sleep("25 millis"));
		}
		return false;
	};
	if (await exited(Date.now() + 500)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	await exited(Date.now() + 500);
}

async function bootDevice(udid: string): Promise<void> {
	if (process.platform !== "darwin") {
		throw new CliError(
			"iOS simulators require macOS and Xcode. Select an Android device on Linux or WSL.",
		);
	}
	if (!(await isDeviceBooted(udid))) {
		try {
			await hostCommandText("xcrun", "simctl", "boot", udid);
		} catch (error: unknown) {
			const message =
				error instanceof Error
					? error.message.toLowerCase()
					: String(error).toLowerCase();
			if (!message.includes("booted") && !message.includes("current state")) {
				throw new CliError(`Failed to boot device ${udid}: ${message}`);
			}
		}
	}
	try {
		await hostCommandText("open", "-ga", "Simulator");
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
}

function getLocalNetworkIP(): string | null {
	const interfaces = networkInterfaces();
	for (const ifaces of Object.values(interfaces)) {
		for (const iface of ifaces ?? []) {
			if (iface.family === "IPv4" && !iface.internal) return iface.address;
		}
	}
	return null;
}

async function findAvailablePort(start: number): Promise<number> {
	const usedPorts = new Set(readAllStates().map((s) => s.port));
	for (let port = start; port < start + 100; port++) {
		if (usedPorts.has(port)) continue;
		if (await isPortFree(port)) return port;
	}
	throw new Error(`No available port found in range ${start}-${start + 99}`);
}

async function ensureBooted(udid: string): Promise<void> {
	await bootDevice(udid);
	try {
		await hostCommandText("xcrun", "simctl", "bootstatus", udid, "-b");
	} catch (error: unknown) {
		if (!(await isDeviceBooted(udid))) {
			throw new CliError(
				`Device ${udid} failed to reach booted state: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}

// ─── Preview server lifecycle ───

function reExecArgs(extra: string[]): { command: string; args: string[] } {
	if (configuredDistDirectory())
		return { command: process.execPath, args: extra };
	if (process.argv[0] && /(^|\/)agentsims$/.test(process.argv[0])) {
		return { command: process.argv[0], args: extra };
	}
	return { command: process.argv[0]!, args: [process.argv[1]!, ...extra] };
}

/** Poll for the state file a re-exec'd preview server writes once it's serving. */
async function waitForStateFile(
	udid: string,
	timeoutMs = 150_000,
): Promise<ServerState | null> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		const state = readState(udid);
		if (state) return state;
		await new Promise((r) => setTimeout(r, 200));
	}
	return null;
}

/**
 * Start a preview server that streams `udid` in-process — it re-execs this CLI
 * in `serve` mode rather than spawning the old Swift helper. Detached + unref'd
 * for daemon mode (`--detach`); attached otherwise so the caller can monitor it.
 */
async function startHelper(
	udid: string,
	port: number,
	opts: { detach: boolean },
): Promise<{ pid: number; child?: ChildProcess }> {
	debugHelper("startHelper udid=%s port=%d detach=%s", udid, port, opts.detach);

	const host = "127.0.0.1";
	ensureStateDir();
	clearState(udid); // don't read a stale state file from a previous run
	await killPortHolder(port);

	const logFile = join(STATE_DIR, `server-${udid}.log`);
	const logFd = openSync(logFile, "w");
	const { command, args } = reExecArgs([
		udid,
		"--port",
		String(port),
		"--host",
		host,
	]);
	const child = nodeSpawn(command, args, {
		detached: opts.detach,
		stdio: ["ignore", logFd, logFd],
	});
	closeSync(logFd);
	if (opts.detach) child.unref();

	// The child boots the sim then writes its state once it's bound + serving.
	const state = await waitForStateFile(udid);
	if (!state) {
		if (child.pid) await stopProcess(child.pid);
		let log = "";
		try {
			log = readFileSync(logFile, "utf-8").trim();
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
		throw new CliError(
			log ? `Preview server failed:\n${log}` : "Preview server failed to start",
		);
	}
	return opts.detach ? { pid: state.pid } : { pid: state.pid, child };
}

// ─── Commands ───

async function startStreams(
	devices: string[],
	startPort: number,
	detached: boolean,
	quiet: boolean,
) {
	const udids =
		devices.length > 0
			? await Promise.all(devices.map(resolveDevice))
			: await (async () => {
					const booted = await findBootedDevice();
					if (booted) return [booted];
					const fallback = await pickDefaultDevice();
					if (!fallback)
						throw new CliError(
							"No device specified and no available iOS simulator found.",
						);
					if (!quiet && !detached)
						console.log(`No booted simulator — booting ${fallback.name}...`);
					return [fallback.udid];
				})();

	const children = new Map<string, ChildProcess>();
	const states: ServerState[] = [];
	let port = startPort;

	for (const udid of udids) {
		// Return existing server if already running
		const existing = readState(udid);
		if (existing) {
			if (!quiet && !detached) {
				const name = (await getDeviceName(udid)) ?? udid;
				if (udids.length > 1) console.log(`\n==> ${name} (${udid}) <==`);
				console.log(`  Already running on port ${existing.port}`);
				console.log(`  Stream:    ${existing.streamUrl}`);
				console.log(`  WebSocket: ${existing.wsUrl}`);
			}
			states.push(existing);
			continue;
		}

		port = await findAvailablePort(port);
		const { child } = await startHelper(udid, port, { detach: detached });

		if (child) {
			children.set(udid, child);
		}

		// The re-exec'd preview server wrote its own in-process state (same-origin
		// /helper URLs); reuse it rather than reconstructing helper-port URLs.
		const state =
			readState(udid) ?? inProcessDeviceState(udid, port, "/", "127.0.0.1");
		states.push(state);

		if (!quiet && !detached) {
			const name = (await getDeviceName(udid)) ?? udid;
			if (udids.length > 1) console.log(`\n==> ${name} (${udid}) <==`);
			console.log(`  Stream:    ${state.streamUrl}`);
			console.log(`  WebSocket: ${state.wsUrl}`);
			console.log(`  Port:      ${port}`);
		}

		port++;
	}

	return { states, children };
}

/** Foreground follow mode owns only the children it started. */
async function follow(devices: string[], startPort: number, quiet: boolean) {
	debugCli("follow devices=%o startPort=%d", devices, startPort);
	const { states, children } = await startStreams(
		devices,
		startPort,
		false,
		quiet,
	);
	printStatesJSON(states);
	// If no new children were spawned (all already running), exit
	if (children.size === 0) return;

	let shuttingDown = false;

	const cleanup = async (exitCode: number) => {
		if (shuttingDown) return;
		shuttingDown = true;
		if (!quiet) console.log("\nShutting down...");
		for (const [udid, child] of children) {
			const pid = child.pid;
			if (pid) await stopProcess(pid);
			clearState(udid);
		}
		children.clear();
		process.exitCode = exitCode;
	};

	// Monitor children — exit when all die (helper crashed / exited on its own)
	for (const [udid, child] of children) {
		child.on("exit", (code) => {
			debugHelper("child exit udid=%s pid=%d code=%s", udid, child.pid, code);
			if (shuttingDown) return;
			if (!quiet) console.error(`[${udid}] Helper exited (code ${code})`);
			clearState(udid);
			children.delete(udid);
			if (children.size === 0) void cleanup(code ?? 1);
		});
	}

	// Clean shutdown on signal
	process.on("SIGINT", () => {
		void cleanup(0);
	});
	process.on("SIGTERM", () => {
		void cleanup(0);
	});
	process.on("SIGHUP", () => {
		void cleanup(0);
	});

	// Last-resort synchronous cleanup if something else exits the process
	process.on("exit", () => {
		for (const [udid, child] of children) {
			try {
				if (child.pid) process.kill(child.pid, "SIGTERM");
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
			try {
				clearState(udid);
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
		}
	});

	while (children.size > 0) await Effect.runPromise(Effect.sleep("100 millis"));
}

/** Detach mode (--detach). Spawns helpers and returns their states. */
async function detach(
	devices: string[],
	startPort: number,
): Promise<ServerState[]> {
	debugCli("detach devices=%o startPort=%d", devices, startPort);
	return (await startStreams(devices, startPort, true, true)).states;
}

function printStatesJSON(states: ServerState[]) {
	const devices = states.map(({ url, streamUrl, wsUrl, port, device }) => ({
		url,
		streamUrl,
		wsUrl,
		port,
		device,
	}));
	console.log(JSON.stringify(devices.length === 1 ? devices[0] : { devices }));
}

/** List running streams (--list). */
async function listStreams(deviceArg?: string) {
	if (deviceArg) {
		const udid = await resolveDevice(deviceArg);
		const state = readState(udid);
		if (!state) {
			console.log(JSON.stringify({ running: false, device: udid }));
		} else {
			console.log(
				JSON.stringify({
					running: true,
					url: state.url,
					streamUrl: state.streamUrl,
					wsUrl: state.wsUrl,
					port: state.port,
					device: state.device,
					pid: state.pid,
				}),
			);
		}
		return;
	}

	const states = readAllStates();
	if (states.length === 0) {
		console.log(JSON.stringify({ running: false }));
	} else if (states.length === 1) {
		const s = states[0]!;
		console.log(
			JSON.stringify({
				running: true,
				url: s.url,
				streamUrl: s.streamUrl,
				wsUrl: s.wsUrl,
				port: s.port,
				device: s.device,
				pid: s.pid,
			}),
		);
	} else {
		console.log(
			JSON.stringify({
				running: true,
				streams: states.map((s) => ({
					url: s.url,
					streamUrl: s.streamUrl,
					wsUrl: s.wsUrl,
					port: s.port,
					device: s.device,
					pid: s.pid,
				})),
			}),
		);
	}
}

/** Kill running streams (--kill). */
async function killStreams(deviceArg?: string) {
	if (deviceArg) {
		const udid = await resolveDevice(deviceArg);
		const state = readState(udid);
		if (!state) {
			console.log(JSON.stringify({ disconnected: true, device: udid }));
			return;
		}
		try {
			process.kill(state.pid, "SIGTERM");
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
		clearState(udid);
		console.log(JSON.stringify({ disconnected: true, device: state.device }));
	} else {
		const states = readAllStates();
		if (states.length === 0) {
			console.log(JSON.stringify({ disconnected: true, devices: [] }));
			return;
		}
		const devices: string[] = [];
		for (const state of states) {
			try {
				process.kill(state.pid, "SIGTERM");
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
			devices.push(state.device);
		}
		clearState();
		console.log(JSON.stringify({ disconnected: true, devices }));
	}
}

// Send a CoreAnimation debug option toggle to the helper, which invokes
// -[SimDevice setCADebugOption:enabled:] (CoreSimulator private category).
// The known option strings are the ones Simulator.app uses: see Protocol.swift.
async function caDebug(option: string, stateRaw: string, deviceArg?: string) {
	const stateArg = (stateRaw ?? "").toLowerCase();
	const enabled = stateArg === "on" || stateArg === "1" || stateArg === "true";
	const aliases: Record<string, string> = {
		blended: "debug_color_blended",
		copies: "debug_color_copies",
		copied: "debug_color_copies",
		misaligned: "debug_color_misaligned",
		offscreen: "debug_color_offscreen",
		"slow-animations": "debug_slow_animations",
		slow: "debug_slow_animations",
	};
	const resolved = option ? (aliases[option] ?? option) : undefined;
	if (
		!resolved ||
		!["on", "off", "1", "0", "true", "false"].includes(stateArg)
	) {
		throw new CliError(
			`Usage: agentsims ca-debug <option> <on|off> [-d udid]\n  option shortcuts: ${Object.keys(aliases).join(", ")}`,
		);
	}

	const stateFile = readState(deviceArg);
	if (!stateFile)
		throw new CliError("No agentsims server running. Run `agentsims` first.");

	return new Promise<void>((resolve, reject) => {
		const ws = new WebSocket(stateFile.wsUrl);
		ws.binaryType = "arraybuffer";
		ws.onopen = () => {
			const json = new TextEncoder().encode(
				JSON.stringify({ option: resolved, enabled }),
			);
			const msg = new Uint8Array(1 + json.length);
			msg[0] = 0x08;
			msg.set(json, 1);
			ws.send(msg);
			setTimeout(() => {
				ws.close();
				resolve();
			}, 50);
		};
		ws.onerror = () => {
			console.error(
				"Failed to connect to agentsims server at",
				stateFile.wsUrl,
			);
			reject(new Error("WebSocket connection failed"));
		};
	});
}

// Ask the helper to invoke -[SimDevice simulateMemoryWarning].
async function memoryWarning(deviceArg?: string) {
	const stateFile = readState(deviceArg);
	if (!stateFile)
		throw new CliError("No agentsims server running. Run `agentsims` first.");
	return new Promise<void>((resolve, reject) => {
		const ws = new WebSocket(stateFile.wsUrl);
		ws.binaryType = "arraybuffer";
		ws.onopen = () => {
			ws.send(new Uint8Array([0x09]));
			setTimeout(() => {
				ws.close();
				resolve();
			}, 50);
		};
		ws.onerror = () => {
			console.error(
				"Failed to connect to agentsims server at",
				stateFile.wsUrl,
			);
			reject(new Error("WebSocket connection failed"));
		};
	});
}

// ─── Camera injection ───

/**
 * `agentsims camera <bundle-id> [-d udid] [source-options] [--build]`
 *
 * Launches a simulator app with SimCameraInjector loaded via
 * DYLD_INSERT_LIBRARIES. The host-side helper streams BGRA frames into a
 * POSIX shared-memory region the dylib mmaps; this function picks the source
 * (placeholder / webcam / image), spawns or reuses the helper, and then
 * launches the app. If the helper is already running, source changes are
 * hot-swapped through its control socket without relaunching the app.
 */
async function camera(args: string[]) {
	let deviceArg: string | undefined;
	let filePath: string | undefined;
	let webcam: string | true | undefined;
	let stopWebcam = false;
	let listWebcams = false;
	let forceBuild = false;
	let quiet = false;
	let mirror: "auto" | "on" | "off" = "auto";
	const filtered: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const a = args[i];
		if (a === "--device" || a === "-d") {
			deviceArg = args[++i];
			continue;
		}
		if (
			a === "--file" ||
			a === "-f" ||
			a === "--image" ||
			a === "-i" ||
			a === "--video"
		) {
			// --image / --video are kept as silent aliases so existing scripts
			// and the in-page client can land on `--file` without a flag day.
			filePath = args[++i];
			continue;
		}
		if (a === "--webcam") {
			const next = args[i + 1];
			if (next && !next.startsWith("-")) {
				webcam = next;
				i++;
			} else {
				webcam = true;
			}
			continue;
		}
		if (a === "--list-webcams") {
			listWebcams = true;
			continue;
		}
		if (a === "--stop-webcam") {
			stopWebcam = true;
			continue;
		}
		if (a === "--build") {
			forceBuild = true;
			continue;
		}
		if (a === "--quiet" || a === "-q") {
			quiet = true;
			continue;
		}
		if (a === "--mirror") {
			const next = args[i + 1];
			if (next === "on" || next === "off" || next === "auto") {
				mirror = next;
				i++;
			} else {
				mirror = "on";
			}
			continue;
		}
		if (a === "--no-mirror") {
			mirror = "off";
			continue;
		}
		if (a === "--help" || a === "-h") {
			console.log(`Usage: agentsims camera <bundle-id> [-d udid] [source-options] [--build]
       agentsims camera switch <placeholder|webcam|file> [arg] [-d udid]
       agentsims camera mirror <auto|on|off> [-d udid]
       agentsims camera --list-webcams
       agentsims camera --stop-webcam [-d udid]

Launches the simulator app with a synthetic camera feed injected. The
host helper streams BGRA frames (default: an animated placeholder) into
shared memory; the dylib swizzles AVFoundation so the app reads them.

If the helper is already running for the device, source flags hot-swap
the feed without relaunching the app.

Source options (pick one; default is placeholder):
  -f, --file <path>          Image or video file (kind auto-detected)
      --webcam [name]        Live host webcam (default: built-in front camera)

Other:
  -d, --device <udid|name>   Target a specific simulator (default: booted)
      --mirror [on|off|auto] Override preview mirroring (default: auto =
                             front mirrored, back not). Data-output buffers
                             are never auto-mirrored, matching AVF defaults.
      --no-mirror            Shortcut for --mirror off
      --build                Rebuild dylib + helper from source
      --list-webcams         List host camera devices (with --webcam values)
      --stop-webcam          Stop the running camera helper for the device
  -q, --quiet                JSON-only output

Examples:
  agentsims camera com.acme.MyApp                            # placeholder feed
  agentsims camera com.acme.MyApp --webcam                   # default webcam
  agentsims camera com.acme.MyApp --webcam "MacBook Pro Camera"
  agentsims camera com.acme.MyApp --file ~/Pictures/face.png # static image
  agentsims camera com.acme.MyApp --file ~/Movies/loop.mp4   # looping video
  agentsims camera switch webcam                             # hot-swap to webcam
  agentsims camera switch placeholder                        # back to placeholder
  agentsims camera switch ~/Movies/loop.mp4                  # hot-swap to file
  agentsims camera --list-webcams
  agentsims camera --stop-webcam`);
			return;
		}
		filtered.push(a!);
	}

	if (listWebcams) {
		const helper = locateCameraHelper() ?? (await buildCameraHelper());
		process.stdout.write(await hostCommandText(helper, "--list"));
		return;
	}

	if (stopWebcam) {
		const udid = deviceArg
			? await resolveDevice(deviceArg)
			: await findBootedDevice();
		if (!udid) throw new CliError("No booted simulator.");
		const injectedBundles = readInjectedBundles(udid);
		const terminated: string[] = [];
		for (const bundle of injectedBundles) {
			try {
				await hostCommandText("xcrun", "simctl", "terminate", udid, bundle);
				terminated.push(bundle);
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
		}
		await stopExistingHelper(udid);
		if (quiet) console.log(JSON.stringify({ udid, stopped: true, terminated }));
		else {
			console.log(`Stopped camera helper for ${udid}`);
			if (terminated.length > 0)
				console.log(`Terminated injected apps: ${terminated.join(", ")}`);
		}
		return;
	}

	// `agentsims camera mirror <auto|on|off> [-d udid]`
	// Hot-swap the preview-layer mirror mode without touching the app.
	if (filtered[0] === "mirror") {
		const udid = deviceArg
			? await resolveDevice(deviceArg)
			: await findBootedDevice();
		if (!udid) throw new CliError("No booted simulator.");
		const mode = filtered[1];
		if (mode !== "auto" && mode !== "on" && mode !== "off") {
			throw new CliError(
				"Usage: agentsims camera mirror <auto|on|off> [-d udid]",
			);
		}
		if (!isHelperAlive(udid)) {
			throw new CliError(
				"Camera helper not running for this device. Run `agentsims camera <bundle-id>` first.",
			);
		}
		const reply = await sendHelperCommand(udid, { action: "setMirror", mode });
		if (!reply.ok)
			throw new CliError(`Mirror failed: ${reply.error ?? "unknown error"}`);
		if (quiet) console.log(JSON.stringify({ udid, mirror: mode, ok: true }));
		else console.log(`📷 Mirror → ${mode} on ${udid}`);
		return;
	}

	// `agentsims camera switch <source> [arg] [-d udid]`
	// Hot-swap the helper's source without touching the simulator app.
	if (filtered[0] === "switch") {
		const udid = deviceArg
			? await resolveDevice(deviceArg)
			: await findBootedDevice();
		if (!udid) throw new CliError("No booted simulator.");
		let wanted = filtered[1];
		let arg: string | undefined = filtered[2];
		if (
			wanted &&
			wanted !== "placeholder" &&
			wanted !== "webcam" &&
			wanted !== "image" &&
			wanted !== "video" &&
			wanted !== "file"
		) {
			const candidate = resolve(wanted);
			if (existsSync(candidate)) {
				arg = candidate;
				wanted = "file";
			}
		}
		if (wanted === "file") {
			if (!arg) throw new CliError("camera switch file <path>");
			arg = resolve(arg);
			const detected = detectMediaKind(arg);
			if (!detected)
				throw new CliError(`Could not detect image/video type for: ${arg}`);
			wanted = detected;
		}
		if (
			!wanted ||
			(wanted !== "placeholder" &&
				wanted !== "webcam" &&
				wanted !== "image" &&
				wanted !== "video")
		) {
			throw new CliError(
				"Usage: agentsims camera switch <placeholder|webcam|file> [arg] [-d udid]",
			);
		}
		if ((wanted === "image" || wanted === "video") && arg) arg = resolve(arg);
		if (!isHelperAlive(udid)) {
			throw new CliError(
				"Camera helper not running for this device. Run `agentsims camera <bundle-id>` first.",
			);
		}
		const reply = await sendHelperCommand(udid, {
			action: "switch",
			source: wanted,
			arg,
		});
		if (!reply.ok)
			throw new CliError(`Switch failed: ${reply.error ?? "unknown error"}`);
		if (quiet) console.log(JSON.stringify({ udid, ...reply }));
		else
			console.log(
				`📷 Switched ${udid} → ${reply.source}${reply.arg ? ` (${reply.arg})` : ""}`,
			);
		return;
	}

	// `agentsims camera status [-d udid]` — JSON-only probe used by the
	// preview UI (and humans) to see whether the helper is still alive after
	// a page reload, so we don't have to "Inject + relaunch" the app just to
	// re-establish UI state.
	if (filtered[0] === "status") {
		const udid = deviceArg
			? await resolveDevice(deviceArg)
			: await findBootedDevice();
		if (!udid) {
			console.log(
				JSON.stringify({ alive: false, error: "no booted simulator" }),
			);
			return;
		}
		if (!isHelperAlive(udid)) {
			console.log(JSON.stringify({ udid, alive: false }));
			return;
		}
		let helperPid: number | null = null;
		try {
			helperPid =
				Number(readFileSync(cameraHelperFiles(udid).pid, "utf-8").trim()) ||
				null;
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
		const bundleIds = readInjectedBundles(udid);
		try {
			const reply = await sendHelperCommand(udid, { action: "status" });
			console.log(
				JSON.stringify({ udid, alive: true, helperPid, bundleIds, ...reply }),
			);
		} catch (error: unknown) {
			console.log(
				JSON.stringify({
					udid,
					alive: true,
					helperPid,
					bundleIds,
					error: error instanceof Error ? error.message : String(error),
				}),
			);
		}
		return;
	}

	const bundleId = filtered[0];
	if (!bundleId)
		throw new CliError(
			"Usage: agentsims camera <bundle-id> [--image <path>] [-d udid]",
		);

	const udid = deviceArg
		? await resolveDevice(deviceArg)
		: await findBootedDevice();
	if (!udid)
		throw new CliError("No booted simulator. Boot one or pass -d <udid|name>.");

	const result = await attachCamera({
		udid,
		bundleId,
		file: filePath,
		webcam,
		mirror,
		forceBuild,
	});
	const {
		pid,
		dylib,
		source,
		arg,
		shm: shmName,
		helperPid,
		helperRelaunched,
	} = result;
	if (quiet) {
		console.log(JSON.stringify(result));
	} else {
		const verb = helperRelaunched ? "Injected" : "Attached";
		console.log(
			`📷 ${verb} camera into ${bundleId} (pid ${pid ?? "?"}) on ${udid}`,
		);
		console.log(`   source: ${source}${arg ? ` (${arg})` : ""}`);
		if (helperPid) console.log(`   helper pid: ${helperPid}  (shm ${shmName})`);
		console.log(`   dylib: ${dylib}`);
	}
}

// ─── Serve preview ───

/** Resolve which already-running simulators to stream, without spawning anything. */
async function resolveTargetDevices(devices: string[]): Promise<string[]> {
	const androidDevices = await listAndroidDevices();
	if (devices.length > 0) {
		return Promise.all(
			devices.map(async (device) => {
				const stateSerial = androidSerialFromStateId(device);
				if (
					stateSerial &&
					androidDevices.some(
						(candidate) =>
							candidate.serial === stateSerial && candidate.state === "device",
					)
				) {
					return androidStateId(stateSerial);
				}
				const connected = androidDevices.find(
					(candidate) =>
						candidate.state === "device" &&
						(candidate.serial === device ||
							candidate.avdName?.toLowerCase() === device.toLowerCase()),
				);
				if (!connected && process.platform !== "darwin") {
					throw new CliError(
						`Android device ${device} is not connected. Start an emulator or connect a device. Run npx agentsims doctor --platform android for setup checks.`,
					);
				}
				return connected
					? androidStateId(connected.serial)
					: resolveDevice(device);
			}),
		);
	}
	const existing = readAllStates().filter(
		(state) =>
			process.platform === "darwin" ||
			androidSerialFromStateId(state.device) !== null,
	);
	if (existing.length > 0)
		return [...new Set(existing.map((state) => state.device))];
	return [
		...Object.values((await listIosDevices({ booted: true })) ?? {})
			.flat()
			.filter((device) => device.state === "Booted")
			.map((device) => device.udid),
		...androidDevices
			.filter((device) => device.state === "device")
			.map((device) => androidStateId(device.serial)),
	];
}

async function serve(
	servePort: number,
	devices: string[],
	portExplicit: boolean,
	host: string,
	codec: string | undefined,
) {
	// Boot the target simulators; the preview server streams them in-process
	// (no spawned helper). Sessions are created lazily on the first stream request.
	const targetDevices = await resolveTargetDevices(devices);
	for (const udid of targetDevices) {
		if (!androidSerialFromStateId(udid)) await ensureBooted(udid);
	}
	const appConfig = Effect.runSync(
		resolveAppConfig(
			{
				host,
				port: servePort,
				codec: codec === "mjpeg" || codec === "h264" ? codec : "auto",
				basePath: "/",
				proxyHelpers: true,
			},
			process.env,
		),
	);
	const targetDevice = targetDevices[0];

	const execToken = randomBytes(32).toString("base64url");
	const maxScan = portExplicit ? 1 : 50;
	let boundPort = servePort;
	let lastErr: unknown;
	let previewServer: PreviewServer | null = null;
	for (let i = 0; i < maxScan; i++) {
		const port = servePort + i;
		try {
			previewServer = await servePreview({
				...appConfig,
				basePath: "/",
				host,
				port,
				device: targetDevice,
				codec,
				proxyHelpers: true,
				previewRoot: previewRootForRuntime(),
				execToken,
				agentsimsBin: configuredDistDirectory()
					? process.execPath
					: (process.argv[1] ?? "agentsims"),
			});
			boundPort = port;
			break;
		} catch (error) {
			lastErr = error;
		}
	}
	if (!previewServer) {
		const code =
			lastErr && typeof lastErr === "object" && "code" in lastErr
				? lastErr.code
				: undefined;
		if (code === "EADDRINUSE") {
			throw new CliError(
				portExplicit
					? `Port ${servePort} is already in use. Pass a different --port or stop the other process.`
					: `No available port found in range ${servePort}-${servePort + maxScan - 1}.`,
			);
		}
		throw new CliError(
			`Failed to start preview server: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
		);
	}

	// Record in-process state so the preview/grid enumerate these devices and the
	// CLI input subcommands can reach the same-origin /helper ws.
	for (const udid of targetDevices) {
		writeState(inProcessDeviceState(udid, boundPort, "/", host));
	}
	const clearAll = () => {
		for (const udid of targetDevices) {
			try {
				clearState(udid);
			} catch (error) {
				console.warn("[agentsims:cli] recoverable operation failed", error);
			}
		}
	};
	process.on("exit", clearAll);

	const exposedToLan =
		host !== "127.0.0.1" && host !== "localhost" && host !== "::1";
	const networkIP = getLocalNetworkIP();
	console.log("");
	console.log(`  - Local:   http://localhost:${boundPort}`);
	if (exposedToLan && networkIP) {
		console.log(`  - Network: http://${networkIP}:${boundPort}`);
	} else if (networkIP) {
		console.log(
			`  - Network: \x1b[2muse --host 0.0.0.0 to expose on http://${networkIP}:${boundPort}\x1b[0m`,
		);
	} else {
		console.log(
			"  - Network: \x1b[2muse --host 0.0.0.0 to expose on the LAN\x1b[0m",
		);
	}
	console.log("");

	let stopping = false;
	const stopped = Promise.withResolvers<void>();
	const stop = () => {
		if (stopping) return;
		stopping = true;
		void (async () => {
			try {
				await previewServer.stop();
			} finally {
				clearAll();
				stopped.resolve();
			}
		})();
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
	await stopped.promise;
}

// ─── Main ───

const program = new Command();

program
	.name("agentsims")
	.description("Run an iOS and Android device workspace in the browser")
	.version(resolveVersion(), "-v, --version", "Output the agentsims version")
	.helpOption("-h, --help", "Show this help")
	// The default command: start the preview server (or stream / list / kill).
	.argument(
		"[devices...]",
		"Simulator(s) to target (udid or name; default: booted)",
	)
	.option(
		"-p, --port <port>",
		"Starting port (preview default: 3200; helper default: 3100)",
		(v) => parseInt(v, 10),
	)
	.option(
		"--host <addr>",
		"Interface to bind the preview server to. Use 0.0.0.0 to expose on the " +
			"LAN — only on trusted networks: the preview exposes a token-gated " +
			"shell-exec route.",
		previewHostFromEnvironment(),
	)
	.option("--detach", "Spawn helper and exit (daemon mode)")
	.option("-q, --quiet", "Suppress human-readable output, JSON only")
	.option(
		"--no-preview",
		"Skip the web preview server; stream in foreground only",
	)
	.option(
		"--codec <codec>",
		"Stream codec for the preview UI: 'auto' (H.264 when the browser can decode " +
			"it) or 'mjpeg' (force software JPEG — e.g. on VMs without H.264 encode).",
		(value) => {
			const v = value.toLowerCase();
			const allowed = ["auto", "h264", "mjpeg"];
			if (!allowed.includes(v)) {
				throw new InvalidArgumentError(
					`Unsupported codec '${value}'. Supported: ${allowed.join(", ")}.`,
				);
			}
			return v;
		},
	)
	.option("-l, --list [device]", "List running streams")
	.option("-k, --kill [device]", "Kill running stream(s)")
	.addHelpText(
		"after",
		`
Examples:
  agentsims                              Open simulator preview at localhost:3200
  agentsims -p 8080                      Preview on a custom port
  agentsims --codec mjpeg                Force MJPEG (e.g. on VMs without H.264 encode)
  agentsims --no-preview                 Auto-detect booted sim, stream in foreground
  agentsims --no-preview "iPhone 16 Pro" Stream a specific device (no preview)
  agentsims --detach                     Start streaming in background (daemon)
  agentsims --list                       Show all running streams
  agentsims --kill                       Stop all streams`,
	)
	.action(async (devices: string[], opts) => {
		if (opts.list !== undefined) {
			listStreams(typeof opts.list === "string" ? opts.list : undefined);
			return;
		}
		if (opts.kill !== undefined) {
			killStreams(typeof opts.kill === "string" ? opts.kill : undefined);
			return;
		}
		const startPort: number | undefined = opts.port;
		if (opts.detach) {
			const states = await detach(devices, startPort ?? 3100);
			printStatesJSON(states);
		} else if (opts.preview === false) {
			await follow(devices, startPort ?? 3100, !!opts.quiet);
		} else {
			const environmentPort = previewPortFromEnvironment();
			await serve(
				startPort ?? environmentPort ?? 3200,
				devices,
				startPort !== undefined || environmentPort !== undefined,
				opts.host,
				opts.codec,
			);
		}
	});

registerAndroidCommands(program);
addCompatibilityCommands(program);
addSetupCommand(program);
addWorkspaceCommands(program, {
	defaultHost: previewHostFromEnvironment(),
	serve: async (devices, options) => {
		const environmentPort = previewPortFromEnvironment();
		await serve(
			options.port ?? environmentPort ?? 3200,
			devices,
			options.port !== undefined || environmentPort !== undefined,
			options.host,
			options.codec,
		);
	},
	stop: killStreams,
});

program
	.command("ca-debug")
	.description(
		"Toggle a CoreAnimation debug render flag " +
			"(blended|copies|misaligned|offscreen|slow-animations)",
	)
	.argument("<option>")
	.argument("<state>", "on|off")
	.option(...DEVICE_OPTION)
	.action((option: string, state: string, opts) =>
		caDebug(option, state, opts.device),
	);

program
	.command("memory-warning")
	.description("Simulate a memory warning on the device")
	.option(...DEVICE_OPTION)
	.action((opts) => memoryWarning(opts.device));

// `camera` and `permissions` keep their own dedicated argument parsers (the
// camera verb has nested sub-verbs and source flags; permissions has a
// unit-tested parser module). Register them as passthrough commands so they
// still appear in `--help` and route to those parsers verbatim.
program
	.command("camera")
	.description(
		"Inject a synthetic camera feed and launch an app (see `camera --help`)",
	)
	.allowUnknownOption(true)
	.helpOption(false)
	.argument("[args...]")
	.action((args: string[]) => camera(args));

program
	.command("permissions")
	.description(
		"Manage app permissions (see `permissions` with no args for usage)",
	)
	.allowUnknownOption(true)
	.helpOption(false)
	.argument("[args...]")
	.action((args: string[]) => permissions(args));

program
	.command("ui")
	.description("Get or set simulator-wide UI options (see `ui --help`)")
	.allowUnknownOption(true)
	.helpOption(false)
	.argument("[args...]")
	.action((args: string[]) => uiSettings(args));

export async function main(argv: string[] = process.argv): Promise<void> {
	await program.parseAsync(argv);
}

if (import.meta.main) await main();
