#!/usr/bin/env bun
import { Command, InvalidArgumentError } from "commander";
import { Effect } from "effect";
import {
	execFile,
	execSync,
	spawn as nodeSpawn,
	type ChildProcess,
} from "child_process";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
	rmSync,
} from "fs";
import { createHash, randomBytes } from "crypto";
import { networkInterfaces } from "os";
import { join, resolve } from "path";
import { resolveAppConfig } from "../services/app-config";
import {
	STATE_DIR,
	stateFileForDevice,
	listStateFiles,
	inProcessDeviceState,
} from "../shared/state";
import { dirnameOf, isPortFree } from "../server/runtime/runtime";
import { servePreview } from "../server/http/server";
import type { PreviewServer } from "../server/runtime/runtime";
import { configuredDistDirectory } from "../server/runtime/runtime-paths";
import { killPortHolder } from "../server/runtime/ports";
import { hostCommandText } from "../server/runtime/host-tools-runtime";
import {
	findBootedDevice,
	resolveDevice,
	SIMCTL_LIST_MAX_BUFFER_BYTES,
} from "../ios/device/device";
import {
	androidSerialFromStateId,
	androidStateId,
	listAndroidDevices,
} from "../android/device/device";
import { permissions } from "../ios/device/permissions";
import { uiSettings } from "../ios/device/ui-settings";
import { debugCli, debugHelper, debugState } from "../shared/debug";
import { readAllStates, readState, type ServerState } from "./device-state";
import { addCompatibilityCommands } from "./compatibility-commands";
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
	try {
		const data = JSON.parse(
			await hostCommandText("xcrun", "simctl", "list", "devices", "-j"),
		) as {
			devices: Record<
				string,
				Array<{
					udid: string;
					name: string;
					state: string;
					isAvailable?: boolean;
				}>
			>;
		};
		const iosRuntimes = Object.keys(data.devices)
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
			const iphone = (data.devices[runtime] ?? []).find(
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
	try {
		const data = JSON.parse(
			await hostCommandText("xcrun", "simctl", "list", "devices", "-j"),
		) as {
			devices: Record<
				string,
				Array<{ udid: string; name: string; state: string }>
			>;
		};
		for (const runtime of Object.values(data.devices)) {
			for (const device of runtime)
				if (device.udid === udid) return device.name;
		}
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	return null;
}

async function isDeviceBooted(udid: string): Promise<boolean> {
	try {
		const data = JSON.parse(
			await hostCommandText("xcrun", "simctl", "list", "devices", "-j"),
		) as {
			devices: Record<string, Array<{ udid: string; state: string }>>;
		};
		for (const runtime of Object.values(data.devices)) {
			for (const device of runtime)
				if (device.udid === udid) return device.state === "Booted";
		}
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	return false;
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

/** Foreground follow mode (default). Stays attached, cleans up on Ctrl+C. */
async function follow(devices: string[], startPort: number, quiet: boolean) {
	debugCli("follow devices=%o startPort=%d", devices, startPort);
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
					if (!quiet)
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
			if (!quiet) {
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
		const { child } = await startHelper(udid, port, { detach: false });

		if (child) {
			children.set(udid, child);
		}

		// The re-exec'd preview server wrote its own in-process state (same-origin
		// /helper URLs); reuse it rather than reconstructing helper-port URLs.
		const state =
			readState(udid) ?? inProcessDeviceState(udid, port, "/", "127.0.0.1");
		states.push(state);

		if (!quiet) {
			const name = (await getDeviceName(udid)) ?? udid;
			if (udids.length > 1) console.log(`\n==> ${name} (${udid}) <==`);
			console.log(`  Stream:    ${state.streamUrl}`);
			console.log(`  WebSocket: ${state.wsUrl}`);
			console.log(`  Port:      ${port}`);
		}

		port++;
	}

	// Machine-readable JSON to stdout
	if (states.length === 1) {
		const s = states[0]!;
		console.log(
			JSON.stringify({
				url: s.url,
				streamUrl: s.streamUrl,
				wsUrl: s.wsUrl,
				port: s.port,
				device: s.device,
			}),
		);
	} else {
		console.log(
			JSON.stringify({
				devices: states.map((s) => ({
					url: s.url,
					streamUrl: s.streamUrl,
					wsUrl: s.wsUrl,
					port: s.port,
					device: s.device,
				})),
			}),
		);
	}

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
					return [fallback.udid];
				})();

	const states: ServerState[] = [];
	let port = startPort;

	for (const udid of udids) {
		const existing = readState(udid);
		if (existing) {
			states.push(existing);
			continue;
		}

		port = await findAvailablePort(port);
		await startHelper(udid, port, { detach: true });

		// Reuse the detached server's own in-process state (same-origin /helper URLs).
		states.push(
			readState(udid) ?? inProcessDeviceState(udid, port, "/", "127.0.0.1"),
		);

		port++;
	}

	return states;
}

function printStatesJSON(states: ServerState[]) {
	if (states.length === 1) {
		const s = states[0]!;
		console.log(
			JSON.stringify({
				url: s.url,
				streamUrl: s.streamUrl,
				wsUrl: s.wsUrl,
				port: s.port,
				device: s.device,
			}),
		);
	} else {
		console.log(
			JSON.stringify({
				devices: states.map((s) => ({
					url: s.url,
					streamUrl: s.streamUrl,
					wsUrl: s.wsUrl,
					port: s.port,
					device: s.device,
				})),
			}),
		);
	}
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
 * Resolve the path to the SimCameraInjector dylib. The dev/source layout
 * places it under packages/agentsims/dist/simcam/; the published npm tarball
 * ships the same file at <package>/dist/simcam/.
 */
function locateCameraDylib(): string | null {
	const candidates = [
		join(__dirname, "..", "..", "dist", "simcam", "libSimCameraInjector.dylib"),
		join(__dirname, "..", "dist", "simcam", "libSimCameraInjector.dylib"),
		join(__dirname, "simcam", "libSimCameraInjector.dylib"),
	];
	for (const p of candidates) {
		if (existsSync(p)) return resolve(p);
	}
	return null;
}

async function buildCameraDylib(): Promise<string> {
	const buildScript =
		[
			join(__dirname, "..", "..", "ios", "camera-injector", "build.sh"),
			join(__dirname, "..", "ios", "camera-injector", "build.sh"),
		].find((candidate) => existsSync(candidate)) ?? "";
	if (!existsSync(buildScript)) {
		throw new CliError(
			"SimCameraInjector source not found. Reinstall from a recent release.",
		);
	}
	console.error("[agentsims] building libSimCameraInjector.dylib (one-time)…");
	await hostCommandText("bash", buildScript);
	const out = locateCameraDylib();
	if (!out)
		throw new CliError("Build succeeded but the camera dylib was not found.");
	return out;
}

function locateCameraHelper(): string | null {
	const candidates = [
		join(__dirname, "..", "..", "dist", "simcam", "agentsims-camera-helper"),
		join(__dirname, "..", "dist", "simcam", "agentsims-camera-helper"),
		join(__dirname, "simcam", "agentsims-camera-helper"),
	];
	for (const p of candidates) if (existsSync(p)) return resolve(p);
	return null;
}

async function buildCameraHelper(): Promise<string> {
	const buildScript =
		[
			join(__dirname, "..", "..", "ios", "camera-helper", "build.sh"),
			join(__dirname, "..", "ios", "camera-helper", "build.sh"),
		].find((candidate) => existsSync(candidate)) ?? "";
	if (!existsSync(buildScript)) {
		throw new CliError(
			"SimCameraHelper source not found. Webcam support requires ios/camera-helper.",
		);
	}
	console.error("[agentsims] building agentsims-camera-helper (one-time)…");
	await hostCommandText("bash", buildScript);
	const out = locateCameraHelper();
	if (!out)
		throw new CliError("Build succeeded but the camera helper was not found.");
	return out;
}

const SIMCAM_STATE_DIR = join(STATE_DIR, "simcam");

function shmNameForUdid(udid: string): string {
	// POSIX shm names on macOS have a 31-char limit. Hash the UDID short.
	const short = createHash("sha1").update(udid).digest("hex").slice(0, 8);
	return `/agentsims-cam-${short}`;
}

function helperPidFile(udid: string): string {
	return join(SIMCAM_STATE_DIR, `${udid}.pid`);
}

function helperBundlesFile(udid: string): string {
	return join(SIMCAM_STATE_DIR, `${udid}.bundles.json`);
}

interface InjectedBundlesState {
	helperPid: number;
	bundleIds: string[];
}

function helperSocketFile(udid: string): string {
	// POSIX sun_path is 104 chars on macOS — keep this short.
	const short = createHash("sha1").update(udid).digest("hex").slice(0, 12);
	return `/tmp/agentsims-cam-${short}.sock`;
}

interface HelperReply {
	ok?: boolean;
	source?: string;
	arg?: string;
	error?: string;
}

async function sendHelperCommand(
	udid: string,
	cmd: object,
): Promise<HelperReply> {
	const sockPath = helperSocketFile(udid);
	if (!existsSync(sockPath)) throw new Error("camera helper socket not found");
	const net = await import("net");
	return await new Promise((resolve, reject) => {
		const c = net.createConnection(sockPath);
		let buf = "";
		let settled = false;
		c.on("data", (d) => {
			buf += d.toString();
			const nl = buf.indexOf("\n");
			if (nl >= 0 && !settled) {
				settled = true;
				try {
					resolve(JSON.parse(buf.slice(0, nl)));
				} catch (e) {
					reject(e);
				}
				c.end();
			}
		});
		c.on("error", (e) => {
			if (!settled) {
				settled = true;
				reject(e);
			}
		});
		c.on("close", () => {
			if (!settled) {
				settled = true;
				reject(new Error("socket closed"));
			}
		});
		c.write(JSON.stringify(cmd) + "\n");
		setTimeout(() => {
			if (!settled) {
				settled = true;
				c.destroy();
				reject(new Error("helper timeout"));
			}
		}, 3000);
	});
}

function isHelperAlive(udid: string): boolean {
	const pf = helperPidFile(udid);
	if (!existsSync(pf)) return false;
	const pid = Number(readFileSync(pf, "utf-8").trim());
	return (
		Number.isFinite(pid) &&
		isProcessAlive(pid) &&
		existsSync(helperSocketFile(udid))
	);
}

function readInjectedBundles(udid: string): string[] {
	const path = helperBundlesFile(udid);
	if (!existsSync(path)) return [];
	let state: InjectedBundlesState;
	try {
		state = JSON.parse(readFileSync(path, "utf-8")) as InjectedBundlesState;
	} catch {
		return [];
	}
	let currentHelperPid: number | null = null;
	try {
		currentHelperPid =
			Number(readFileSync(helperPidFile(udid), "utf-8").trim()) || null;
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	if (currentHelperPid == null || state.helperPid !== currentHelperPid)
		return [];
	return Array.isArray(state.bundleIds) ? state.bundleIds : [];
}

function recordInjectedBundle(
	udid: string,
	bundleId: string,
	helperPid: number,
): void {
	const existing = readInjectedBundles(udid);
	const bundleIds = existing.includes(bundleId)
		? existing
		: [...existing, bundleId];
	const next: InjectedBundlesState = { helperPid, bundleIds };
	if (!existsSync(SIMCAM_STATE_DIR))
		mkdirSync(SIMCAM_STATE_DIR, { recursive: true });
	writeFileSync(helperBundlesFile(udid), JSON.stringify(next));
}

function clearInjectedBundles(udid: string): void {
	try {
		unlinkSync(helperBundlesFile(udid));
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
}

async function stopExistingHelper(udid: string): Promise<void> {
	const pf = helperPidFile(udid);
	if (!existsSync(pf)) return;
	const pid = Number(readFileSync(pf, "utf-8").trim());
	if (Number.isFinite(pid) && isProcessAlive(pid)) {
		try {
			process.kill(pid, "SIGTERM");
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
		const deadline = Date.now() + 1500;
		while (isProcessAlive(pid) && Date.now() < deadline) {
			await Effect.runPromise(Effect.sleep("50 millis"));
		}
	}
	try {
		unlinkSync(pf);
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	clearInjectedBundles(udid);
}

async function spawnCameraHelper(args: {
	udid: string;
	helperBin: string;
	shmName: string;
	socketPath: string;
	source: CamSourceKind;
	arg?: string;
	width?: number;
	height?: number;
}): Promise<number> {
	if (!existsSync(SIMCAM_STATE_DIR))
		mkdirSync(SIMCAM_STATE_DIR, { recursive: true });
	const logPath = join(SIMCAM_STATE_DIR, `${args.udid}.log`);
	const out = openSync(logPath, "a");
	const argv = [
		"--shm",
		args.shmName,
		"--socket",
		args.socketPath,
		"--source",
		args.source,
	];
	if (args.arg) argv.push("--arg", args.arg);
	if (args.width) argv.push("--width", String(args.width));
	if (args.height) argv.push("--height", String(args.height));
	const child = nodeSpawn(args.helperBin, argv, {
		detached: true,
		stdio: ["ignore", out, out],
	});
	child.unref();
	closeSync(out);
	if (!child.pid) throw new Error("failed to spawn camera helper");
	writeFileSync(helperPidFile(args.udid), String(child.pid));
	clearInjectedBundles(args.udid);
	// Wait briefly until the helper has populated the shm header AND the
	// control socket is listening (proves it's healthy and ready for switch).
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		if (!isProcessAlive(child.pid)) {
			throw new Error(`camera helper exited early — see log at ${logPath}`);
		}
		if (existsSync(args.socketPath)) break;
		await Effect.runPromise(Effect.sleep("50 millis"));
	}
	return child.pid;
}

type CamSourceKind = "placeholder" | "webcam" | "image" | "video";

interface ResolvedSource {
	kind: CamSourceKind;
	arg?: string;
}

// Tell image/video apart from a path. We sniff the file's magic bytes
// rather than trusting the extension because:
//   1) the file may have arrived via the in-page drop zone, where it
//      lands at /tmp/<uuid> with no meaningful suffix; and
//   2) callers pass real-world paths like .heic / .mov / .gif that
//      shouldn't need a separate flag in the CLI surface.
const VIDEO_EXTS = new Set([
	"mp4",
	"m4v",
	"mov",
	"qt",
	"avi",
	"mkv",
	"webm",
	"mpg",
	"mpeg",
	"3gp",
	"3g2",
	"ts",
	"wmv",
]);
const IMAGE_EXTS = new Set([
	"png",
	"jpg",
	"jpeg",
	"gif",
	"heic",
	"heif",
	"webp",
	"bmp",
	"tif",
	"tiff",
]);

function detectMediaKind(filePath: string): "image" | "video" | null {
	const ext = filePath.toLowerCase().split(".").pop() ?? "";
	if (VIDEO_EXTS.has(ext)) return "video";
	if (IMAGE_EXTS.has(ext)) return "image";

	// Magic-byte sniff — covers files renamed without an extension, plus
	// common containers we didn't enumerate above. Read a 16-byte header.
	let header: Buffer;
	try {
		const fd = openSync(filePath, "r");
		header = Buffer.alloc(16);
		readSync(fd, header, 0, header.length, 0);
		closeSync(fd);
	} catch {
		return null;
	}

	// ISO base media: bytes 4..8 are an "ftyp" box. Catches mp4/mov/m4v/3gp.
	if (header.length >= 8 && header.slice(4, 8).toString("ascii") === "ftyp") {
		return "video";
	}
	// RIFF (WebP / AVI). WEBP / AVI distinguishes via bytes 8..12.
	if (header.slice(0, 4).toString("ascii") === "RIFF" && header.length >= 12) {
		const tag = header.slice(8, 12).toString("ascii");
		if (tag === "AVI ") return "video";
		if (tag === "WEBP") return "image";
	}
	// Matroska / WebM EBML.
	if (
		header[0] === 0x1a &&
		header[1] === 0x45 &&
		header[2] === 0xdf &&
		header[3] === 0xa3
	) {
		return "video";
	}
	// PNG.
	if (
		header[0] === 0x89 &&
		header[1] === 0x50 &&
		header[2] === 0x4e &&
		header[3] === 0x47
	) {
		return "image";
	}
	// JPEG.
	if (header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
		return "image";
	// GIF.
	if (header.slice(0, 6).toString("ascii").startsWith("GIF8")) return "image";
	// BMP.
	if (header[0] === 0x42 && header[1] === 0x4d) return "image";
	return null;
}

function resolveSourceArg(opts: {
	file?: string;
	webcam?: string | true;
}): ResolvedSource {
	if (opts.file) {
		const abs = resolve(opts.file);
		const kind = detectMediaKind(abs);
		if (!kind) {
			throw new Error(`Could not detect image/video type for: ${abs}`);
		}
		return { kind, arg: abs };
	}
	if (opts.webcam) {
		return {
			kind: "webcam",
			arg: typeof opts.webcam === "string" ? opts.webcam : undefined,
		};
	}
	return { kind: "placeholder" };
}

async function ensureHelperWithSource(opts: {
	udid: string;
	source: ResolvedSource;
	forceBuild: boolean;
}): Promise<{
	helperPid: number | null;
	shmName: string;
	relaunched: boolean;
}> {
	const shmName = shmNameForUdid(opts.udid);
	const sockPath = helperSocketFile(opts.udid);
	if (isHelperAlive(opts.udid)) {
		// Hot-swap source via control socket — no relaunch needed.
		const reply = await sendHelperCommand(opts.udid, {
			action: "switch",
			source: opts.source.kind,
			arg: opts.source.arg,
		});
		if (!reply.ok) throw new Error(reply.error || "helper rejected switch");
		return {
			helperPid: Number(readFileSync(helperPidFile(opts.udid), "utf-8").trim()),
			shmName,
			relaunched: false,
		};
	}
	// Need to start a fresh helper. Pre-emptively reap any stale state.
	await stopExistingHelper(opts.udid);
	const helper =
		(!opts.forceBuild && locateCameraHelper()) || (await buildCameraHelper());
	const pid = await spawnCameraHelper({
		udid: opts.udid,
		helperBin: helper,
		shmName,
		socketPath: sockPath,
		source: opts.source.kind,
		arg: opts.source.arg,
	});
	return { helperPid: pid, shmName, relaunched: true };
}

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
				Number(readFileSync(helperPidFile(udid), "utf-8").trim()) || null;
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

	let dylib = forceBuild ? null : locateCameraDylib();
	if (!dylib) dylib = await buildCameraDylib();

	if (filePath && webcam)
		throw new CliError("Pick one source: --file or --webcam, not both.");

	if (filePath) {
		filePath = resolve(filePath);
		if (!existsSync(filePath))
			throw new CliError(`File not found: ${filePath}`);
	}

	const source = resolveSourceArg({ file: filePath, webcam });
	const helperRes = await ensureHelperWithSource({ udid, source, forceBuild });
	const shmName = helperRes.shmName;
	const helperPid = helperRes.helperPid;

	// Mirror lives in the shm header so it can hot-swap. Push every time —
	// the dylib watches the byte each frame and re-applies the layer
	// transform when it differs from the last seen value.
	if (mirror !== "auto" || !helperRes.relaunched) {
		try {
			await sendHelperCommand(udid, { action: "setMirror", mode: mirror });
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		} // non-fatal; dylib falls back to env or default
	}

	// Always (re)launch the named bundle with the dylib. The helper feeds a
	// single shm region keyed by udid, so multiple apps on the same simulator
	// can attach to the same camera stream — but each one has to be launched
	// with DYLD_INSERT_LIBRARIES, which means a terminate+relaunch every time
	// we want to bring a new app into the set. Source-only hot-swaps go
	// through `camera switch`, not this path.
	try {
		await hostCommandText(
			"xcrun",
			"simctl",
			"privacy",
			udid,
			"grant",
			"camera",
			bundleId,
		);
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
	try {
		await hostCommandText("xcrun", "simctl", "terminate", udid, bundleId);
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}

	const env = {
		...process.env,
		SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylib,
		SIMCTL_CHILD_SIMCAM_SHM_NAME: shmName,
		...(mirror !== "auto" ? { SIMCTL_CHILD_SIMCAM_MIRROR_MODE: mirror } : {}),
	};

	const stdoutBuf = await new Promise<string>((resolvePromise, reject) => {
		execFile(
			"xcrun",
			["simctl", "launch", udid, bundleId],
			{ env, encoding: "utf-8" },
			(error, stdout, stderr) => {
				if (error)
					reject(
						new CliError(`simctl launch failed: ${stderr || error.message}`),
					);
				else resolvePromise(stdout);
			},
		);
	});

	const pidMatch = stdoutBuf.trim().match(/:\s*(\d+)\s*$/);
	const pid = pidMatch ? Number(pidMatch[1]) : null;

	if (helperPid) recordInjectedBundle(udid, bundleId, helperPid);

	const result = {
		udid,
		bundleId,
		pid,
		dylib,
		source: source.kind,
		arg: source.arg ?? null,
		shm: shmName,
		helperPid,
		mirror,
		hotSwapped: false,
		helperRelaunched: helperRes.relaunched,
	};
	if (quiet) {
		console.log(JSON.stringify(result));
	} else {
		const verb = helperRes.relaunched ? "Injected" : "Attached";
		console.log(
			`📷 ${verb} camera into ${bundleId} (pid ${pid ?? "?"}) on ${udid}`,
		);
		console.log(
			`   source: ${source.kind}${source.arg ? ` (${source.arg})` : ""}`,
		);
		if (helperPid) console.log(`   helper pid: ${helperPid}  (shm ${shmName})`);
		console.log(`   dylib: ${dylib}`);
	}
}

// ─── Serve preview ───

function listBootedAppleDevices(): string[] {
	if (process.platform !== "darwin") return [];
	try {
		const output = execSync("xcrun simctl list devices booted -j", {
			encoding: "utf8",
			maxBuffer: SIMCTL_LIST_MAX_BUFFER_BYTES,
		});
		const data = JSON.parse(output) as {
			devices: Record<string, Array<{ udid: string; state: string }>>;
		};
		return Object.values(data.devices)
			.flat()
			.filter((device) => device.state === "Booted")
			.map((device) => device.udid);
	} catch {
		return [];
	}
}

/** Resolve which already-running simulators to stream, without spawning anything. */
async function resolveTargetDevices(devices: string[]): Promise<string[]> {
	const androidDevices = (await listAndroidDevices()).filter((device) =>
		/^emulator-\d+$/.test(device.serial),
	);
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
				return connected
					? androidStateId(connected.serial)
					: resolveDevice(device);
			}),
		);
	}
	const existing = readAllStates();
	if (existing.length > 0)
		return [...new Set(existing.map((state) => state.device))];
	return [
		...listBootedAppleDevices(),
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
	.description("Stream iOS Simulator to the browser")
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

const deviceOpt = [
	"-d, --device <id>",
	"Target a running device id from `agentsims --list`",
] as const;

program
	.command("ca-debug")
	.description(
		"Toggle a CoreAnimation debug render flag " +
			"(blended|copies|misaligned|offscreen|slow-animations)",
	)
	.argument("<option>")
	.argument("<state>", "on|off")
	.option(...deviceOpt)
	.action((option: string, state: string, opts) =>
		caDebug(option, state, opts.device),
	);

program
	.command("memory-warning")
	.description("Simulate a memory warning on the device")
	.option(...deviceOpt)
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
