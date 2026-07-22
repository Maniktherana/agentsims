import { readFileSync, unlinkSync } from "fs";
import { execFile } from "child_process";
import {
  androidAvdNameFromStateId,
  androidSerialFromStateId,
  androidStateId,
  launchAndroidAvd,
  listAndroidDevices,
} from "../android/device";
import { closeAndroidSession, getAndroidSession } from "../android/session";
import { closeDeviceSession, getDeviceSession } from "../ios/session";
import { debugMw } from "./debug";
import {
  inProcessServeSimState,
  listStateFiles,
  removeServeSimState,
  writeServeSimState,
  type ServeSimDeviceState,
} from "./state";

type SimctlBootedList = {
  devices: Record<string, Array<{ udid: string; state: string }>>;
};

export type LiveDeviceSnapshot = {
  ios: Set<string> | null;
  android: Set<string> | null;
};

export type StaleStateAction = "keep" | "recycle-self" | "recycle-helper";

function isIosSimulatorId(value: string): boolean {
  return /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(value);
}

export function classifyStaleDeviceState(
  state: Pick<ServeSimDeviceState, "pid" | "device">,
  live: LiveDeviceSnapshot,
  selfPid: number,
): StaleStateAction {
  const androidSerial = androidSerialFromStateId(state.device);
  const stale = androidSerial
    ? live.android !== null && !live.android.has(androidSerial)
    : isIosSimulatorId(state.device)
      ? live.ios !== null && !live.ios.has(state.device)
      : false;
  if (!stale) return "keep";
  return state.pid === selfPid ? "recycle-self" : "recycle-helper";
}

function execFileResult(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ error: Error | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf-8", timeout }, (error, stdout, stderr) => {
      resolve({
        error: error ? new Error(error.message) : null,
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

export class DeviceLifecycle {
  private iosSnapshot: { at: number; devices: Set<string> | null } = { at: 0, devices: null };
  private androidSnapshot: { at: number; devices: Set<string> | null } = { at: 0, devices: null };

  invalidate(): void {
    this.iosSnapshot = { at: 0, devices: null };
    this.androidSnapshot = { at: 0, devices: null };
  }

  async states(): Promise<ServeSimDeviceState[]> {
    const [ios, android] = await Promise.all([
      this.bootedIosDevices(),
      this.connectedAndroidDevices(),
    ]);
    const live = { ios, android };
    const states: ServeSimDeviceState[] = [];

    for (const path of listStateFiles()) {
      try {
        const state = JSON.parse(readFileSync(path, "utf-8")) as ServeSimDeviceState;
        try {
          process.kill(state.pid, 0);
        } catch {
          debugMw("helper pid=%d gone, removing %s", state.pid, path);
          try { unlinkSync(path); } catch {}
          continue;
        }

        const action = classifyStaleDeviceState(state, live, process.pid);
        if (action === "keep") {
          states.push(state);
          continue;
        }

        if (action === "recycle-self") {
          const androidSerial = androidSerialFromStateId(state.device);
          if (androidSerial) closeAndroidSession(androidSerial);
          else closeDeviceSession(state.device);
          debugMw("closing in-process session for unavailable device %s", state.device);
        } else {
          debugMw("recycling stale helper pid=%d for unavailable device %s", state.pid, state.device);
          try { process.kill(state.pid, "SIGTERM"); } catch {}
        }
        try { unlinkSync(path); } catch {}
      } catch {}
    }
    return states;
  }

  select(states: ServeSimDeviceState[], device?: string | null): ServeSimDeviceState | null {
    return device ? states.find((state) => state.device === device) ?? null : states[0] ?? null;
  }

  async start(
    device: string,
    port: number,
    base: string,
  ): Promise<{ error: string | null; device?: string }> {
    const avdName = androidAvdNameFromStateId(device);
    if (avdName) return this.startAndroidAvd(avdName, port, base);

    const androidSerial = androidSerialFromStateId(device);
    if (androidSerial) {
      return { error: await this.startAndroidDevice(androidSerial, port, base), device };
    }

    if (!isIosSimulatorId(device)) return { error: "Invalid or missing device" };
    return { error: await this.startIosDevice(device, port, base), device };
  }

  async shutdown(device: string): Promise<string | null> {
    const androidSerial = androidSerialFromStateId(device);
    if (androidSerial) {
      closeAndroidSession(androidSerial);
      removeServeSimState(device);
      this.invalidate();
      if (!androidSerial.startsWith("emulator-")) return null;
      const result = await execFileResult("adb", ["-s", androidSerial, "emu", "kill"], 10_000);
      return result.error ? result.stderr.trim() || result.error.message : null;
    }

    if (!isIosSimulatorId(device)) return "Invalid or missing device";
    closeDeviceSession(device);
    removeServeSimState(device);
    this.invalidate();
    const result = await execFileResult("xcrun", ["simctl", "shutdown", device], 30_000);
    return result.error ? result.stderr.trim() || result.error.message : null;
  }

  private async startIosDevice(udid: string, port: number, base: string): Promise<string | null> {
    await execFileResult("xcrun", ["simctl", "boot", udid], 30_000);
    const ready = await execFileResult("xcrun", ["simctl", "bootstatus", udid, "-b"], 180_000);
    if (ready.error) {
      const list = await execFileResult("xcrun", ["simctl", "list", "devices", "-j"], 10_000);
      let booted = false;
      try {
        const data = JSON.parse(list.stdout) as SimctlBootedList;
        booted = Object.values(data.devices).flat().some(
          (device) => device.udid === udid && device.state === "Booted",
        );
      } catch {}
      if (!booted) return `Device ${udid} failed to reach booted state`;
    }
    try {
      await getDeviceSession(udid).start();
      writeServeSimState(inProcessServeSimState(udid, port, base));
      this.invalidate();
      return null;
    } catch (error) {
      closeDeviceSession(udid);
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async startAndroidDevice(serial: string, port: number, base: string): Promise<string | null> {
    try {
      await getAndroidSession(serial);
      writeServeSimState(inProcessServeSimState(androidStateId(serial), port, base));
      this.invalidate();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  private async startAndroidAvd(
    avdName: string,
    port: number,
    base: string,
  ): Promise<{ error: string | null; device?: string }> {
    const existing = await listAndroidDevices().catch(() => []);
    const existingMatch = existing.find(
      (device) => device.avdName === avdName && device.state === "device",
    );
    if (existingMatch) {
      const device = androidStateId(existingMatch.serial);
      return { error: await this.startAndroidDevice(existingMatch.serial, port, base), device };
    }

    const before = new Set(existing.map((device) => device.serial));
    try {
      launchAndroidAvd(avdName);
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }

    const deadline = Date.now() + 180_000;
    let lastSeenSerial: string | null = null;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const devices = await listAndroidDevices().catch(() => []);
      const match = devices.find(
        (candidate) => candidate.avdName === avdName && candidate.state === "device",
      ) ?? devices.find(
        (candidate) => !before.has(candidate.serial) && candidate.state === "device" && candidate.serial.startsWith("emulator-"),
      );
      if (match) {
        const device = androidStateId(match.serial);
        return { error: await this.startAndroidDevice(match.serial, port, base), device };
      }
      const appeared = devices.find(
        (candidate) => !before.has(candidate.serial) && candidate.serial.startsWith("emulator-"),
      );
      if (appeared) lastSeenSerial = appeared.serial;
    }
    return {
      error: lastSeenSerial
        ? `Android emulator ${avdName} appeared as ${lastSeenSerial} but did not finish booting`
        : `Android emulator ${avdName} did not appear in adb`,
    };
  }

  private async bootedIosDevices(): Promise<Set<string> | null> {
    const now = Date.now();
    if (this.iosSnapshot.devices && now - this.iosSnapshot.at < 1_500) {
      return this.iosSnapshot.devices;
    }
    const result = await execFileResult("xcrun", ["simctl", "list", "devices", "booted", "-j"], 3_000);
    if (result.error) return null;
    try {
      const data = JSON.parse(result.stdout) as SimctlBootedList;
      const devices = new Set<string>();
      for (const runtime of Object.values(data.devices)) {
        for (const device of runtime) if (device.state === "Booted") devices.add(device.udid);
      }
      this.iosSnapshot = { at: now, devices };
      return devices;
    } catch {
      return null;
    }
  }

  private async connectedAndroidDevices(): Promise<Set<string> | null> {
    const now = Date.now();
    if (this.androidSnapshot.devices && now - this.androidSnapshot.at < 1_500) {
      return this.androidSnapshot.devices;
    }
    try {
      const devices = new Set(
        (await listAndroidDevices())
          .filter((device) => device.state === "device")
          .map((device) => device.serial),
      );
      this.androidSnapshot = { at: now, devices };
      return devices;
    } catch {
      return null;
    }
  }
}

export const deviceLifecycle = new DeviceLifecycle();

export function readDeviceStates(): Promise<ServeSimDeviceState[]> {
  return deviceLifecycle.states();
}

export function selectDeviceState(
  states: ServeSimDeviceState[],
  device?: string | null,
): ServeSimDeviceState | null {
  return deviceLifecycle.select(states, device);
}
