import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { AxElement, AxSnapshot, AxSourceContext } from "./model";

export const DEFAULT_RN_SOURCE_MANIFEST = join(tmpdir(), "agentsims", "rn-source-map.jsonl");

export interface RnSourceManifestEntry {
  testID: string;
  tag: string;
  file?: string;
  absoluteFile?: string;
  line?: number;
  column?: number;
  componentName?: string;
  ownerStack?: string[];
  route?: string;
  visibleText?: string;
  props?: Record<string, string | number | boolean | null>;
  injected?: boolean;
}

interface SourceRegistry {
  byTestID: Map<string, RnSourceManifestEntry>;
}

let cache:
  | {
      path: string;
      size: number;
      mtimeMs: number;
      registry: SourceRegistry;
    }
  | null = null;

export function rnSourceManifestPath(): string {
  return process.env.AGENTSIMS_RN_MANIFEST || DEFAULT_RN_SOURCE_MANIFEST;
}

function normalizeIdentifier(value: string | undefined | null): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const out = new Set<string>([trimmed]);
  const slash = trimmed.lastIndexOf("/");
  if (slash >= 0 && slash < trimmed.length - 1) out.add(trimmed.slice(slash + 1));
  const colon = trimmed.lastIndexOf(":");
  if (colon >= 0 && colon < trimmed.length - 1) out.add(trimmed.slice(colon + 1));
  return [...out];
}

function loadRegistry(path = rnSourceManifestPath()): SourceRegistry {
  try {
    if (!existsSync(path)) return { byTestID: new Map() };
    const stat = statSync(path);
    if (cache && cache.path === path && cache.size === stat.size && cache.mtimeMs === stat.mtimeMs) {
      return cache.registry;
    }

    const byTestID = new Map<string, RnSourceManifestEntry>();
    const text = readFileSync(path, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as RnSourceManifestEntry;
        if (!entry.testID) continue;
        byTestID.set(entry.testID, entry);
      } catch {}
    }
    const registry = { byTestID };
    cache = { path, size: stat.size, mtimeMs: stat.mtimeMs, registry };
    return registry;
  } catch {
    return { byTestID: new Map() };
  }
}

function sourceForElement(element: AxElement, registry: SourceRegistry): AxSourceContext | null {
  for (const candidate of [
    ...normalizeIdentifier(element.testId),
    ...normalizeIdentifier(element.nativeId),
    ...normalizeIdentifier(element.id),
  ]) {
    const entry = registry.byTestID.get(candidate);
    if (!entry) continue;
    return {
      kind: "react-native",
      confidence: element.testId === candidate || element.id === candidate ? "exact-testid" : "native-id",
      testID: entry.testID,
      componentName: entry.componentName,
      ownerStack: entry.ownerStack,
      elementName: entry.tag,
      file: entry.file,
      absoluteFile: entry.absoluteFile,
      line: entry.line,
      column: entry.column,
      route: entry.route,
      visibleText: entry.visibleText,
      props: entry.props,
      injected: entry.injected,
    };
  }
  return null;
}

export function enrichAxSnapshotWithRnSource(snapshot: AxSnapshot): AxSnapshot {
  const registry = loadRegistry();
  if (registry.byTestID.size === 0) return snapshot;

  let changed = false;
  const elements = snapshot.elements.map((element) => {
    if (element.source) return element;
    const source = sourceForElement(element, registry);
    if (!source) return element;
    changed = true;
    return { ...element, source };
  });

  return changed ? { ...snapshot, elements } : snapshot;
}
