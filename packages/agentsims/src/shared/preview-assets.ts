import { posix } from "path";

export type PreviewAssetMap = Readonly<Record<string, string>>;

export interface ResolvedPreviewAsset {
  key: string;
  contentBase64: string;
  contentType: string;
}

export function previewAssetContentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json") || path.endsWith(".map")) {
    return "application/json; charset=utf-8";
  }
  if (path.endsWith(".woff2")) return "font/woff2";
  if (path.endsWith(".woff")) return "font/woff";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export function previewAssetKeyForRequest(
  rawUrl: string,
  basePath: string,
): string | null {
  const pathname = rawUrl.split("?", 1)[0] ?? "";
  const normalizedBase = basePath.replace(/\/+$/, "");
  const prefixes = [
    "/assets/",
    ...(normalizedBase && normalizedBase !== "/"
      ? [`${normalizedBase}/assets/`]
      : []),
  ];
  const prefix = prefixes.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return null;
  let suffix: string;
  try {
    suffix = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return "";
  }
  if (!suffix || suffix.split("/").some((segment) => segment === "..")) {
    return "";
  }
  return `assets/${suffix}`;
}

export function resolvePreviewAsset(
  rawUrl: string,
  basePath: string,
  assets: PreviewAssetMap,
): ResolvedPreviewAsset | null | false {
  const key = previewAssetKeyForRequest(rawUrl, basePath);
  if (key === null) return null;
  if (!key || assets[key] === undefined) return false;
  return {
    key,
    contentBase64: assets[key],
    contentType: previewAssetContentType(key),
  };
}

export interface PreviewDynamicImport {
  importer: string;
  specifier: string;
  assetKey: string;
}

export interface PreviewViteManifestChunk {
  file: string;
  dynamicImports?: string[];
  isEntry?: boolean;
}

export type PreviewViteManifest = Readonly<
  Record<string, PreviewViteManifestChunk>
>;

export function enumeratePreviewManifestDynamicImports(
  manifest: PreviewViteManifest,
): string[] {
  const files = new Set<string>();
  for (const chunk of Object.values(manifest)) {
    for (const importKey of chunk.dynamicImports ?? []) {
      const imported = manifest[importKey];
      if (!imported) {
        throw new Error(`Preview manifest omitted dynamic import ${importKey}`);
      }
      files.add(posix.normalize(imported.file));
    }
  }
  return [...files];
}

export function assertPreviewManifestAssetsEmbedded(
  manifest: PreviewViteManifest,
  assets: PreviewAssetMap,
): string[] {
  const manifestAssets = [
    ...new Set(Object.values(manifest).map((chunk) => posix.normalize(chunk.file))),
  ];
  const missing = manifestAssets.filter((file) => assets[file] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Preview build omitted browser assets:\n${missing.map((file) => `  ${file}`).join("\n")}`,
    );
  }
  return manifestAssets;
}

export function enumeratePreviewDynamicImports(
  javascript: Readonly<Record<string, string>>,
): PreviewDynamicImport[] {
  const imports: PreviewDynamicImport[] = [];
  for (const [importer, source] of Object.entries(javascript)) {
    const expression = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
    for (const match of source.matchAll(expression)) {
      const specifier = match[1]!;
      if (!specifier.startsWith(".") && !specifier.startsWith("/")) continue;
      const assetKey = specifier.startsWith("/")
        ? posix.normalize(specifier.slice(1))
        : posix.normalize(posix.join(posix.dirname(importer), specifier));
      imports.push({ importer, specifier, assetKey });
    }
  }
  return imports;
}

export function assertPreviewDynamicImportsEmbedded(
  javascript: Readonly<Record<string, string>>,
  assets: PreviewAssetMap,
): PreviewDynamicImport[] {
  const imports = enumeratePreviewDynamicImports(javascript);
  const missing = imports.filter(({ assetKey }) => assets[assetKey] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `Preview build omitted dynamic assets:\n${missing.map(({ importer, specifier, assetKey }) =>
        `  ${importer}: ${specifier} -> ${assetKey}`
      ).join("\n")}`,
    );
  }
  return imports;
}
