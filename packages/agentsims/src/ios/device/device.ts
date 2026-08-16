import { CliError } from "../../cli/error";
import { hostCommandText } from "../../server/runtime/host-tools-runtime";

export const SIMCTL_LIST_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

type SimctlDevices = {
  devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
};

async function listDevices(...args: string[]): Promise<SimctlDevices | null> {
  if (process.platform !== "darwin") return null;
  try {
    return JSON.parse(await hostCommandText("xcrun", "simctl", "list", "devices", ...args, "-j")) as SimctlDevices;
  } catch {
    return null;
  }
}

export async function findBootedDevice(): Promise<string | null> {
  const data = await listDevices("booted");
  if (!data) return null;
  let fallback: string | null = null;
  for (const [runtime, devices] of Object.entries(data.devices)) {
    for (const device of devices) {
      if (device.state !== "Booted") continue;
      if (/iOS/i.test(runtime)) return device.udid;
      fallback ??= device.udid;
    }
  }
  return fallback;
}

export async function resolveDevice(nameOrUDID: string): Promise<string> {
  if (/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i.test(nameOrUDID)) {
    return nameOrUDID;
  }
  const data = await listDevices();
  if (data) {
    for (const runtime of Object.values(data.devices)) {
      for (const device of runtime) {
        if (device.name.toLowerCase() === nameOrUDID.toLowerCase()) return device.udid;
      }
    }
  }
  throw new CliError(`Could not resolve device: ${nameOrUDID}`);
}
