import { createHash } from "node:crypto";
import {
	existsSync,
	readFileSync,
	mkdirSync,
	writeFileSync,
	unlinkSync,
	openSync,
	closeSync,
	readSync,
} from "node:fs";
import { execFile, spawn as nodeSpawn } from "node:child_process";
import { Effect } from "effect";
import { BunContext } from "@effect/platform-bun";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";
import { STATE_DIR } from "../../shared/state";
import { configuredDistDirectory } from "../../server/runtime/runtime-paths";
import { commandText } from "../../server/runtime/host-tools";

export function cameraHelperFiles(udid: string) {
	const short = createHash("sha1").update(udid).digest("hex").slice(0, 12);
	const root = join(STATE_DIR, "simcam");
	return {
		pid: join(root, `${udid}.pid`),
		bundles: join(root, `${udid}.bundles.json`),
		socket: `/tmp/agentsims-cam-${short}.sock`,
	};
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function currentHelperPid(udid: string): number | null {
	try {
		const pid = Number(
			readFileSync(cameraHelperFiles(udid).pid, "utf8").trim(),
		);
		return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid) ? pid : null;
	} catch {
		return null;
	}
}

export function readInjectedBundles(udid: string): string[] {
	const pid = currentHelperPid(udid);
	if (pid == null) return [];
	try {
		const state = JSON.parse(
			readFileSync(cameraHelperFiles(udid).bundles, "utf8"),
		) as {
			helperPid?: number;
			bundleIds?: unknown;
		};
		if (state.helperPid !== pid || !Array.isArray(state.bundleIds)) return [];
		return state.bundleIds.filter(
			(bundle): bundle is string => typeof bundle === "string",
		);
	} catch {
		return [];
	}
}

function locateCameraArtifact(name: string): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	const roots = [
		configuredDistDirectory(),
		join(here, "..", "..", "..", "dist"),
		join(here, "..", "dist"),
		here,
		dirname(process.execPath),
	];
	for (const root of roots) {
		if (!root) continue;
		const path = join(root, "simcam", name);
		if (existsSync(path)) return resolve(path);
	}
	return null;
}

export const locateCameraHelper = () =>
	locateCameraArtifact("agentsims-camera-helper");
const locateCameraDylib = () =>
	locateCameraArtifact("libSimCameraInjector.dylib");

async function buildCameraArtifact(
	injector: boolean,
	signal?: AbortSignal,
): Promise<string> {
	const root = resolve(
		dirname(fileURLToPath(import.meta.url)),
		"..",
		"..",
		"..",
	);
	const script = join(
		root,
		"ios",
		injector ? "camera-injector" : "camera-helper",
		"build.sh",
	);
	if (!existsSync(script))
		throw new Error(
			injector
				? "SimCameraInjector source not found. Reinstall from a recent release."
				: "iOS camera helper source not found",
		);
	if (injector)
		console.error(
			"[agentsims] building libSimCameraInjector.dylib (one-time)…",
		);
	await Effect.runPromise(
		commandText(
			"bash",
			script,
			...(!injector ? [join(root, "dist", "simcam")] : []),
		).pipe(Effect.provide(BunContext.layer)),
		{ signal },
	);
	const result = injector ? locateCameraDylib() : locateCameraHelper();
	if (!result)
		throw new Error(
			injector
				? "Build succeeded but the camera dylib was not found."
				: "iOS camera helper build succeeded but binary was not found",
		);
	return result;
}
export const buildCameraHelper = (signal?: AbortSignal) =>
	buildCameraArtifact(false, signal);
const buildCameraDylib = (signal?: AbortSignal) =>
	buildCameraArtifact(true, signal);

export async function sendHelperCommand(
	udid: string,
	cmd: object,
): Promise<{ ok?: boolean; source?: string; arg?: string; error?: string }> {
	const socketPath = cameraHelperFiles(udid).socket;
	if (!existsSync(socketPath))
		throw new Error("camera helper socket not found");
	return new Promise((resolve, reject) => {
		const socket = new Socket();
		let buffer = "";
		let settled = false;
		const finish = (
			error?: Error,
			reply?: { ok?: boolean; source?: string; arg?: string; error?: string },
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			if (error) reject(error);
			else resolve(reply!);
		};
		const timer = setTimeout(
			() => finish(new Error("camera helper timeout")),
			3000,
		);
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			if (Buffer.byteLength(buffer) > 65536) {
				finish(new Error("camera helper reply is too large"));
				return;
			}
			const newline = buffer.indexOf("\n");
			if (newline < 0) return;
			try {
				finish(undefined, JSON.parse(buffer.slice(0, newline)));
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		});
		socket.on("error", (error) => finish(error));
		socket.on("close", () => finish(new Error("camera helper socket closed")));
		socket.connect(socketPath, () => socket.write(`${JSON.stringify(cmd)}\n`));
	});
}

const SIMCAM_STATE_DIR = join(STATE_DIR, "simcam");

function shmNameForUdid(udid: string): string {
	// POSIX shm names on macOS have a 31-char limit. Hash the UDID short.
	const short = createHash("sha1").update(udid).digest("hex").slice(0, 8);
	return `/agentsims-cam-${short}`;
}

export function isHelperAlive(udid: string): boolean {
	return (
		currentHelperPid(udid) !== null &&
		existsSync(cameraHelperFiles(udid).socket)
	);
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
	const next = { helperPid, bundleIds };
	if (!existsSync(SIMCAM_STATE_DIR))
		mkdirSync(SIMCAM_STATE_DIR, { recursive: true });
	writeFileSync(cameraHelperFiles(udid).bundles, JSON.stringify(next));
}

function clearInjectedBundles(udid: string): void {
	try {
		unlinkSync(cameraHelperFiles(udid).bundles);
	} catch (error) {
		console.warn("[agentsims:cli] recoverable operation failed", error);
	}
}

export async function stopExistingHelper(udid: string): Promise<void> {
	const pf = cameraHelperFiles(udid).pid;
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
	signal?: AbortSignal;
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
	args.signal?.throwIfAborted();
	const child = nodeSpawn(args.helperBin, argv, {
		detached: true,
		stdio: ["ignore", out, out],
	});
	child.unref();
	closeSync(out);
	if (!child.pid) throw new Error("failed to spawn camera helper");
	writeFileSync(cameraHelperFiles(args.udid).pid, String(child.pid));
	clearInjectedBundles(args.udid);
	// Wait briefly until the helper has populated the shm header AND the
	// control socket is listening (proves it's healthy and ready for switch).
	const deadline = Date.now() + 3000;
	while (Date.now() < deadline) {
		args.signal?.throwIfAborted();
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

// Detect extensionless uploads from their file header.
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

export function detectMediaKind(filePath: string): "image" | "video" | null {
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
	signal?: AbortSignal;
}): Promise<{
	helperPid: number | null;
	shmName: string;
	relaunched: boolean;
}> {
	opts.signal?.throwIfAborted();
	const shmName = shmNameForUdid(opts.udid);
	const sockPath = cameraHelperFiles(opts.udid).socket;
	if (isHelperAlive(opts.udid)) {
		// Hot-swap source via control socket — no relaunch needed.
		const reply = await sendHelperCommand(opts.udid, {
			action: "switch",
			source: opts.source.kind,
			arg: opts.source.arg,
		});
		if (!reply.ok) throw new Error(reply.error || "helper rejected switch");
		return {
			helperPid: Number(
				readFileSync(cameraHelperFiles(opts.udid).pid, "utf-8").trim(),
			),
			shmName,
			relaunched: false,
		};
	}
	// Need to start a fresh helper. Pre-emptively reap any stale state.
	await stopExistingHelper(opts.udid);
	const helper =
		(!opts.forceBuild && locateCameraHelper()) ||
		(await buildCameraHelper(opts.signal));
	const pid = await spawnCameraHelper({
		udid: opts.udid,
		signal: opts.signal,
		helperBin: helper,
		shmName,
		socketPath: sockPath,
		source: opts.source.kind,
		arg: opts.source.arg,
	});
	return { helperPid: pid, shmName, relaunched: true };
}

const attachmentHost = {
	locateDylib: locateCameraDylib,
	buildDylib: buildCameraDylib,
	ensureHelper: ensureHelperWithSource,
	send: sendHelperCommand,
	record: recordInjectedBundle,
	command: (signal: AbortSignal | undefined, ...args: [string, ...string[]]) =>
		Effect.runPromise(
			commandText(...args).pipe(Effect.provide(BunContext.layer)),
			{ signal },
		),
	launch: (
		udid: string,
		bundleId: string,
		env: NodeJS.ProcessEnv,
		signal?: AbortSignal,
	) => {
		return new Promise<string>((resolvePromise, reject) => {
			execFile(
				"xcrun",
				["simctl", "launch", udid, bundleId],
				{ env, signal, encoding: "utf-8" },
				(error, stdout, stderr) => {
					if (error)
						reject(
							new Error(`simctl launch failed: ${stderr || error.message}`),
						);
					else resolvePromise(stdout);
				},
			);
		});
	},
};

export async function attachCamera(
	options: {
		udid: string;
		bundleId: string;
		file?: string;
		webcam?: string | true;
		mirror?: "auto" | "on" | "off";
		forceBuild?: boolean;
		signal?: AbortSignal;
	},
	host = attachmentHost,
) {
	const {
		udid,
		bundleId,
		webcam,
		mirror = "auto",
		forceBuild = false,
	} = options;
	let filePath = options.file;
	const signal = options.signal;
	signal?.throwIfAborted();
	let dylib = forceBuild ? null : host.locateDylib();
	if (!dylib) dylib = await host.buildDylib(signal);

	if (filePath && webcam)
		throw new Error("Pick one source: --file or --webcam, not both.");

	if (filePath) {
		filePath = resolve(filePath);
		if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
	}

	const source = resolveSourceArg({ file: filePath, webcam });
	const helperRes = await host.ensureHelper({
		udid,
		source,
		forceBuild,
		signal,
	});
	const shmName = helperRes.shmName;
	const helperPid = helperRes.helperPid;

	// Existing helpers must reset mirror state, including automatic mode.
	if (mirror !== "auto" || !helperRes.relaunched) {
		try {
			await host.send(udid, { action: "setMirror", mode: mirror });
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		} // non-fatal; dylib falls back to env or default
	}

	// Each attached app must relaunch with the injector, even when its helper is reused.
	for (const args of [
		["privacy", udid, "grant", "camera", bundleId],
		["terminate", udid, bundleId],
	]) {
		try {
			await host.command(signal, "xcrun", "simctl", ...args);
		} catch (error) {
			console.warn("[agentsims:cli] recoverable operation failed", error);
		}
	}

	const env = {
		...process.env,
		SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: dylib,
		SIMCTL_CHILD_SIMCAM_SHM_NAME: shmName,
		...(mirror !== "auto" ? { SIMCTL_CHILD_SIMCAM_MIRROR_MODE: mirror } : {}),
	};

	signal?.throwIfAborted();
	const stdoutBuf = await host.launch(udid, bundleId, env, signal);

	const pidMatch = stdoutBuf.trim().match(/:\s*(\d+)\s*$/);
	const pid = pidMatch ? Number(pidMatch[1]) : null;

	if (helperPid) host.record(udid, bundleId, helperPid);

	return {
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
}
