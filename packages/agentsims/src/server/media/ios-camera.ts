import { createHash } from "crypto";
import { execFile, execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { configuredDistDirectory } from "../runtime/runtime-paths";
import { Socket } from "net";
import { axFrontmostAsync } from "../../ios/stream/native";
import { STATE_DIR } from "../../shared/state";
import type { HostAudioDevice } from "./host-audio";

export type IosCameraSource = "placeholder" | "webcam" | "image" | "video";

export interface IosCameraStatus {
  alive: boolean;
  source?: string;
  arg?: string;
  bundleIds: string[];
}

function simcamDir(): string {
  return join(STATE_DIR, "simcam");
}

function helperPidFile(udid: string): string {
  return join(simcamDir(), `${udid}.pid`);
}

function helperBundlesFile(udid: string): string {
  return join(simcamDir(), `${udid}.bundles.json`);
}

function helperSocketFile(udid: string): string {
  const short = createHash("sha1").update(udid).digest("hex").slice(0, 12);
  return `/tmp/agentsims-cam-${short}.sock`;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function currentHelperPid(udid: string): number | null {
  try {
    const pid = Number(readFileSync(helperPidFile(udid), "utf8").trim());
    return Number.isFinite(pid) && isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function readInjectedBundles(udid: string): string[] {
  const pid = currentHelperPid(udid);
  if (pid == null) return [];
  try {
    const state = JSON.parse(readFileSync(helperBundlesFile(udid), "utf8")) as {
      helperPid?: number;
      bundleIds?: unknown;
    };
    if (state.helperPid !== pid || !Array.isArray(state.bundleIds)) return [];
    return state.bundleIds.filter((bundle): bundle is string => typeof bundle === "string");
  } catch {
    return [];
  }
}

function locateCameraHelper(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const configuredDist = configuredDistDirectory();
  const candidates = [
    ...(configuredDist ? [join(configuredDist, "simcam", "agentsims-camera-helper")] : []),
    join(here, "..", "..", "..", "dist", "simcam", "agentsims-camera-helper"),
    join(here, "simcam", "agentsims-camera-helper"),
    join(dirname(process.execPath), "simcam", "agentsims-camera-helper"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return null;
}

function buildCameraHelper(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const buildScript = join(here, "..", "..", "..", "ios", "camera-helper", "build.sh");
  if (!existsSync(buildScript)) throw new Error("iOS camera helper source not found");
  const outDir = join(here, "..", "..", "..", "dist", "simcam");
  execFileSync("bash", [buildScript, outDir], { stdio: "ignore" });
  const helper = locateCameraHelper();
  if (!helper) throw new Error("iOS camera helper build succeeded but binary was not found");
  return helper;
}

function cameraHelperPath(): string {
  return locateCameraHelper() ?? buildCameraHelper();
}

function locateAgentsimsCli(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const configuredDist = configuredDistDirectory();
  const candidates = [
    ...(configuredDist ? [join(configuredDist, "agentsims.js")] : []),
    join(here, "..", "..", "cli", "index.ts"),
    join(here, "..", "..", "..", "dist", "agentsims.js"),
    process.argv[1],
  ].filter((candidate): candidate is string => !!candidate);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate);
  }
  return "agentsims";
}

function execAgentsimsCli(args: string[]): Promise<string> {
  const bin = locateAgentsimsCli();
  const command = bin === "agentsims" ? "agentsims" : process.execPath;
  const commandArgs = bin === "agentsims" ? args : [bin, ...args];
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      commandArgs,
      { encoding: "utf8", timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

const NON_UI_BUNDLE_RE =
  /(WidgetRenderer|ExtensionHost|\.extension(\.|$)|Service|PlaceholderApp|InCallService|CallUI|InCallUI|com\.apple\.Preferences\.Cellular|com\.apple\.purplebuddy|com\.apple\.chrono|com\.apple\.shuttle|com\.apple\.springboard|com\.apple\.SpringBoard|com\.android\.|com\.google\.)/i;

function isUserFacingBundle(bundleId: string): boolean {
  return !bundleId.startsWith("com.apple.") && !NON_UI_BUNDLE_RE.test(bundleId);
}

async function sendHelperCommand(udid: string, cmd: object): Promise<Record<string, unknown>> {
  const socketPath = helperSocketFile(udid);
  if (!existsSync(socketPath) || currentHelperPid(udid) == null) {
    throw new Error("iOS camera helper is not attached to an app");
  }
  return await new Promise((resolvePromise, reject) => {
    const socket = new Socket();
    let buffer = "";
    let settled = false;
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline < 0 || settled) return;
      settled = true;
      try {
        resolvePromise(JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>);
      } catch (reason) {
        reject(reason);
      }
      socket.end();
    });
    socket.on("error", (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    socket.on("close", () => {
      if (!settled) {
        settled = true;
        reject(new Error("camera helper socket closed"));
      }
    });
    socket.setTimeout(3_000, () => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error("camera helper timeout"));
      }
    });
    socket.connect(socketPath, () => socket.write(`${JSON.stringify(cmd)}\n`));
  });
}

export async function getIosCameraStatus(udid: string): Promise<IosCameraStatus> {
  if (!existsSync(helperSocketFile(udid)) || currentHelperPid(udid) == null) {
    return { alive: false, bundleIds: [] };
  }
  const reply = await sendHelperCommand(udid, { action: "status" });
  return {
    alive: reply.ok === true,
    source: typeof reply.source === "string" ? reply.source : undefined,
    arg: typeof reply.arg === "string" ? reply.arg : undefined,
    bundleIds: readInjectedBundles(udid),
  };
}

export async function switchIosCameraSource(
  udid: string,
  source: IosCameraSource,
  arg?: string,
): Promise<void> {
  const reply = await sendHelperCommand(udid, {
    action: "switch",
    source,
    ...(arg ? { arg } : {}),
  });
  if (reply.ok !== true) {
    throw new Error(
      typeof reply.error === "string" ? reply.error : "camera helper rejected switch",
    );
  }
}

export async function findFrontmostIosAppBundle(udid: string): Promise<string> {
  const info = JSON.parse(await axFrontmostAsync(udid)) as { bundleId?: string };
  if (!info.bundleId || !isUserFacingBundle(info.bundleId)) {
    throw new Error("Open the app you want to attach camera routing to, then try again");
  }
  return info.bundleId;
}

export async function attachOrSwitchIosCameraSource(
  udid: string,
  source: IosCameraSource,
  arg?: string,
): Promise<"live" | "app-relaunch"> {
  const status = await getIosCameraStatus(udid).catch(() => ({ alive: false, bundleIds: [] }));
  if (status.alive && status.bundleIds.length > 0) {
    await switchIosCameraSource(udid, source, arg);
    return "live";
  }
  const bundleId = await findFrontmostIosAppBundle(udid);
  const args = ["camera", bundleId, "-d", udid, "--quiet"];
  if (source === "webcam") {
    args.push("--webcam");
    if (arg) args.push(arg);
  } else if (source === "image" || source === "video") {
    if (!arg) throw new Error(`${source} camera source requires a file path`);
    args.push("--file", arg);
  }
  await execAgentsimsCli(args);
  return "app-relaunch";
}

export async function listIosWebcams(): Promise<HostAudioDevice[]> {
  if (process.platform !== "darwin") return [];
  return await new Promise((resolvePromise, reject) => {
    execFile(
      cameraHelperPath(),
      ["--list"],
      { encoding: "utf8", timeout: 5_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolvePromise(
          stdout.split(/\r?\n/).flatMap((line) => {
            const [id, label] = line.split("\t");
            return id && label ? [{ id, label }] : [];
          }),
        );
      },
    );
  });
}
