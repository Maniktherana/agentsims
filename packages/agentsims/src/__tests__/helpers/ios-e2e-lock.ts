import { randomUUID } from "crypto";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const IOS_E2E_HOOK_TIMEOUT_MS = 10 * 60_000;

interface LockOwner {
  pid: number;
  token: string;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readOwner(path: string): LockOwner | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
    return Number.isInteger(value.pid) && typeof value.token === "string"
      ? { pid: value.pid!, token: value.token }
      : null;
  } catch {
    return null;
  }
}

export async function acquireIosSimulatorTestLock(
  device: string,
): Promise<() => void> {
  const root = join(tmpdir(), "agentsims-tests");
  const lockPath = join(root, `ios-${device}.lock`);
  const ownerPath = join(lockPath, "owner.json");
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + IOS_E2E_HOOK_TIMEOUT_MS;
  mkdirSync(root, { recursive: true });

  while (Date.now() < deadline) {
    try {
      mkdirSync(lockPath);
      writeFileSync(ownerPath, JSON.stringify(owner));
      return () => {
        if (readOwner(ownerPath)?.token === owner.token) {
          rmSync(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = readOwner(ownerPath);
      if (current && !processIsAlive(current.pid)) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      await Bun.sleep(50);
    }
  }

  throw new Error(`Timed out waiting for the iOS simulator test lock: ${device}`);
}
