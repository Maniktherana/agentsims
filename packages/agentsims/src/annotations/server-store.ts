import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  watch,
  writeFileSync,
} from "fs";
import { extname, join } from "path";
import { STATE_DIR } from "../shared/state";
import {
  annotationScopeKey,
  annotationScopesEqual,
  annotationStatus,
  isAnnotationScope,
  legacyAnnotationScope,
  type AnnotationScope,
  type AnnotationStatus,
} from "./model";

const ANNOTATION_DIR = join(STATE_DIR, "annotations");
const ANNOTATION_FILE = join(ANNOTATION_DIR, "annotations.json");
const SCREENSHOT_DIR = join(ANNOTATION_DIR, "screenshots");

export interface StoredAnnotation {
  id: string;
  scope?: AnnotationScope;
  status?: AnnotationStatus;
  resolvedAt?: number;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: unknown;
}

interface LegacyAnnotationStoreFile {
  version: 1;
  devices: Record<string, StoredAnnotation[]>;
}

export interface AnnotationScopeBucket {
  scope: AnnotationScope;
  annotations: StoredAnnotation[];
}

export interface AnnotationStoreFile {
  version: 2;
  scopes: Record<string, AnnotationScopeBucket>;
}

export interface StoredScreenshot {
  id: string;
  path: string;
  mimeType: "image/jpeg" | "image/png";
}

function emptyStore(): AnnotationStoreFile {
  return { version: 2, scopes: {} };
}

function normalizeStoredAnnotation(
  annotation: StoredAnnotation,
  scope: AnnotationScope,
): StoredAnnotation {
  const normalized: StoredAnnotation = {
    ...annotation,
    scope,
    status: annotationStatus(annotation),
  };
  if (normalized.status === "open") delete normalized.resolvedAt;
  return normalized;
}

function validStoredAnnotation(value: unknown): value is StoredAnnotation {
  return !!value && typeof value === "object" && typeof (value as StoredAnnotation).id === "string";
}

/**
 * Converts the original device-keyed file into scope buckets in memory. The
 * migration is written atomically on the next mutation, so merely upgrading
 * Agentsims never destroys a readable legacy file.
 */
export function migrateAnnotationStore(value: unknown): AnnotationStoreFile {
  if (!value || typeof value !== "object") return emptyStore();
  const parsed = value as {
    version?: unknown;
    scopes?: Record<string, AnnotationScopeBucket>;
    devices?: LegacyAnnotationStoreFile["devices"];
  };
  const migrated = emptyStore();

  if (parsed.version === 2 && parsed.scopes && typeof parsed.scopes === "object") {
    for (const candidate of Object.values(parsed.scopes)) {
      if (!candidate || !isAnnotationScope(candidate.scope) || !Array.isArray(candidate.annotations)) {
        continue;
      }
      const annotations = candidate.annotations
        .filter(validStoredAnnotation)
        .map((annotation) => normalizeStoredAnnotation(annotation, candidate.scope));
      migrated.scopes[annotationScopeKey(candidate.scope)] = {
        scope: candidate.scope,
        annotations,
      };
    }
    return migrated;
  }

  if (parsed.version === 1 && parsed.devices && typeof parsed.devices === "object") {
    for (const [device, candidates] of Object.entries(parsed.devices)) {
      if (!Array.isArray(candidates)) continue;
      const scope = legacyAnnotationScope(device);
      migrated.scopes[annotationScopeKey(scope)] = {
        scope,
        annotations: candidates
          .filter(validStoredAnnotation)
          .map((annotation) => normalizeStoredAnnotation(annotation, scope)),
      };
    }
  }
  return migrated;
}

function readStore(): AnnotationStoreFile {
  try {
    return migrateAnnotationStore(JSON.parse(readFileSync(ANNOTATION_FILE, "utf8")));
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

function scopeForWrite(
  device: string,
  annotation: StoredAnnotation,
  requestedScope?: AnnotationScope,
): AnnotationScope {
  const annotationScope = isAnnotationScope(annotation.scope) ? annotation.scope : undefined;
  if (
    requestedScope &&
    annotationScope &&
    !annotationScopesEqual(requestedScope, annotationScope)
  ) {
    throw new Error("Annotation body scope does not match the requested scope");
  }
  const scope = requestedScope ?? annotationScope ?? legacyAnnotationScope(device);
  if (scope.captureDeviceId !== device) {
    throw new Error("Annotation scope device does not match the selected device");
  }
  return scope;
}

function annotationsFromStore(
  store: AnnotationStoreFile,
  device: string,
  scope?: AnnotationScope,
): StoredAnnotation[] {
  if (scope) {
    return store.scopes[annotationScopeKey(scope)]?.annotations ?? [];
  }
  return Object.values(store.scopes)
    .filter((bucket) => bucket.scope.captureDeviceId === device)
    .flatMap((bucket) => bucket.annotations);
}

export function listStoredAnnotations(
  device: string,
  scope?: AnnotationScope,
): StoredAnnotation[] {
  return annotationsFromStore(readStore(), device, scope);
}

export function listStoredAnnotationDevices(): Array<{
  device: string;
  annotations: StoredAnnotation[];
}> {
  const store = readStore();
  const devices = new Map<string, StoredAnnotation[]>();
  for (const bucket of Object.values(store.scopes)) {
    const current = devices.get(bucket.scope.captureDeviceId) ?? [];
    current.push(...bucket.annotations);
    devices.set(bucket.scope.captureDeviceId, current);
  }
  return [...devices].map(([device, annotations]) => ({ device, annotations }));
}

export function upsertStoredAnnotation(
  device: string,
  annotation: StoredAnnotation,
  requestedScope?: AnnotationScope,
): StoredAnnotation[] {
  if (!validId(annotation.id)) throw new Error("Invalid annotation id");
  const store = readStore();
  const scope = scopeForWrite(device, annotation, requestedScope);
  const key = annotationScopeKey(scope);
  const current = store.scopes[key]?.annotations ?? [];
  const normalized = normalizeStoredAnnotation(annotation, scope);
  const index = current.findIndex((entry) => entry.id === annotation.id);
  store.scopes[key] = {
    scope,
    annotations: index === -1
      ? [normalized, ...current]
      : current.map((entry, entryIndex) => entryIndex === index ? normalized : entry),
  };
  writeStore(store);
  return store.scopes[key].annotations;
}

export function setStoredAnnotationStatus(
  device: string,
  id: string,
  status: AnnotationStatus,
  scope?: AnnotationScope,
): StoredAnnotation {
  if (!validId(id)) throw new Error("Invalid annotation id");
  const store = readStore();
  const bucket = Object.values(store.scopes).find((candidate) =>
    candidate.scope.captureDeviceId === device &&
    (!scope || annotationScopesEqual(candidate.scope, scope)) &&
    candidate.annotations.some((annotation) => annotation.id === id)
  );
  const annotation = bucket?.annotations.find((entry) => entry.id === id);
  if (!bucket || !annotation) throw new Error(`Annotation ${id} was not found on ${device}`);

  const now = Date.now();
  const { resolvedAt: _resolvedAt, ...unresolved } = annotation;
  const next: StoredAnnotation = status === "resolved"
    ? { ...annotation, status, resolvedAt: now, updatedAt: now }
    : { ...unresolved, status, updatedAt: now };
  upsertStoredAnnotation(device, next, bucket.scope);
  return next;
}

export function removeStoredAnnotation(
  device: string,
  id?: string,
  scope?: AnnotationScope,
): StoredAnnotation[] {
  const store = readStore();
  if (id && !validId(id)) throw new Error("Invalid annotation id");
  for (const bucket of Object.values(store.scopes)) {
    if (bucket.scope.captureDeviceId !== device) continue;
    if (scope && !annotationScopesEqual(bucket.scope, scope)) continue;
    bucket.annotations = id
      ? bucket.annotations.filter((entry) => entry.id !== id)
      : [];
  }
  writeStore(store);
  return annotationsFromStore(store, device, scope);
}

export function watchStoredAnnotations(listener: () => void): () => void {
  mkdirSync(ANNOTATION_DIR, { recursive: true });
  try {
    const watcher = watch(ANNOTATION_DIR, (_event, filename) => {
      if (filename && !filename.toString().startsWith("annotations.json")) return;
      listener();
    });
    return () => watcher.close();
  } catch {
    return () => {};
  }
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
