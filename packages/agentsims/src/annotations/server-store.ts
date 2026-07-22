import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "fs";
import { extname, join } from "path";
import { STATE_DIR } from "../shared/state";

const ANNOTATION_DIR = join(STATE_DIR, "annotations");
const ANNOTATION_FILE = join(ANNOTATION_DIR, "annotations.json");
const SCREENSHOT_DIR = join(ANNOTATION_DIR, "screenshots");

export interface StoredAnnotation {
  id: string;
  [key: string]: unknown;
}

interface AnnotationStoreFile {
  version: 1;
  devices: Record<string, StoredAnnotation[]>;
}

export interface StoredScreenshot {
  id: string;
  path: string;
  mimeType: "image/jpeg" | "image/png";
}

function emptyStore(): AnnotationStoreFile {
  return { version: 1, devices: {} };
}

function readStore(): AnnotationStoreFile {
  try {
    const parsed = JSON.parse(readFileSync(ANNOTATION_FILE, "utf8")) as Partial<AnnotationStoreFile>;
    if (parsed.version !== 1 || !parsed.devices || typeof parsed.devices !== "object") return emptyStore();
    return { version: 1, devices: parsed.devices };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: AnnotationStoreFile): void {
  mkdirSync(ANNOTATION_DIR, { recursive: true });
  const temporary = `${ANNOTATION_FILE}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(store, null, 2));
  renameSync(temporary, ANNOTATION_FILE);
}

function validId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}

export function listStoredAnnotations(device: string): StoredAnnotation[] {
  return readStore().devices[device] ?? [];
}

export function listStoredAnnotationDevices(): Array<{
  device: string;
  annotations: StoredAnnotation[];
}> {
  const store = readStore();
  return Object.entries(store.devices).map(([device, annotations]) => ({ device, annotations }));
}

export function upsertStoredAnnotation(device: string, annotation: StoredAnnotation): StoredAnnotation[] {
  if (!validId(annotation.id)) throw new Error("Invalid annotation id");
  const store = readStore();
  const current = store.devices[device] ?? [];
  const index = current.findIndex((entry) => entry.id === annotation.id);
  store.devices[device] = index === -1
    ? [annotation, ...current]
    : current.map((entry, entryIndex) => entryIndex === index ? annotation : entry);
  writeStore(store);
  return store.devices[device];
}

export function removeStoredAnnotation(device: string, id?: string): StoredAnnotation[] {
  const store = readStore();
  if (id && !validId(id)) throw new Error("Invalid annotation id");
  store.devices[device] = id
    ? (store.devices[device] ?? []).filter((entry) => entry.id !== id)
    : [];
  writeStore(store);
  return store.devices[device];
}

export function writeStoredScreenshot(
  id: string,
  bytes: Uint8Array,
  mimeType: StoredScreenshot["mimeType"],
): StoredScreenshot {
  if (!validId(id)) throw new Error("Invalid screenshot id");
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const extension = mimeType === "image/png" ? ".png" : ".jpg";
  const path = join(SCREENSHOT_DIR, `${id}${extension}`);
  writeFileSync(path, bytes);
  return { id, path, mimeType };
}

export function readStoredScreenshot(id: string): StoredScreenshot | null {
  if (!validId(id)) return null;
  for (const extension of [".png", ".jpg"] as const) {
    const path = join(SCREENSHOT_DIR, `${id}${extension}`);
    if (!existsSync(path)) continue;
    return {
      id,
      path,
      mimeType: extname(path) === ".png" ? "image/png" : "image/jpeg",
    };
  }
  return null;
}
