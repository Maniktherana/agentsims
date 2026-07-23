import { afterAll, describe, expect, test } from "bun:test";
import {
  annotationScopeKey,
  legacyAnnotationScope,
  type AnnotationScope,
} from "../annotations/model";
import {
  listStoredAnnotations,
  migrateAnnotationStore,
  removeStoredAnnotation,
  setStoredAnnotationStatus,
  upsertStoredAnnotation,
} from "../annotations/server-store";
import { fetchAuthoritativeAnnotations } from "../annotations/web/state/device-annotation-state";

const device = `annotation-data-${process.pid}-${Date.now()}`;
const baseScope: AnnotationScope = {
  projectId: "project-a",
  bundleId: "com.example.app",
  sessionId: "session-a",
  captureDeviceId: device,
  capturePlatform: "ios",
};
const alternateScope: AnnotationScope = {
  ...baseScope,
  sessionId: "session-b",
  route: "/settings",
};

afterAll(() => {
  removeStoredAnnotation(device);
});

describe("annotation data lifecycle", () => {
  test("treats an empty server response as authoritative without uploading local data", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      requests.push({
        url: String(input),
        method: init?.method ?? "GET",
      });
      return new Response(JSON.stringify({ device, annotations: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const annotations = await fetchAuthoritativeAnnotations(
      "/annotations",
      device,
      baseScope,
      undefined,
      fetchImpl,
    );

    expect(annotations).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toContain("sessionId=session-a");
  });

  test("migrates device-keyed records into an explicit legacy scope", () => {
    const legacy = migrateAnnotationStore({
      version: 1,
      devices: {
        [device]: [
          {
            id: "legacy-note",
            note: "Preserve me",
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    });
    const scope = legacyAnnotationScope(device);
    const bucket = legacy.scopes[annotationScopeKey(scope)];

    expect(legacy.version).toBe(2);
    expect(bucket?.scope).toEqual(scope);
    expect(bucket?.annotations).toEqual([
      expect.objectContaining({
        id: "legacy-note",
        status: "open",
        scope,
      }),
    ]);
  });

  test("isolates records by scope while preserving device-only listing", () => {
    upsertStoredAnnotation(device, {
      id: "scope-a-note",
      note: "First session",
      scope: baseScope,
    });
    upsertStoredAnnotation(device, {
      id: "scope-b-note",
      note: "Second session",
      scope: alternateScope,
    });

    expect(listStoredAnnotations(device, baseScope).map((entry) => entry.id)).toEqual([
      "scope-a-note",
    ]);
    expect(listStoredAnnotations(device, alternateScope).map((entry) => entry.id)).toEqual([
      "scope-b-note",
    ]);
    expect(listStoredAnnotations(device).map((entry) => entry.id).sort()).toEqual([
      "scope-a-note",
      "scope-b-note",
    ]);
  });

  test("resolves and reopens annotations with typed lifecycle timestamps", () => {
    upsertStoredAnnotation(device, {
      id: "lifecycle-note",
      note: "Needs work",
      scope: baseScope,
      status: "open",
      updatedAt: 10,
    });

    const resolved = setStoredAnnotationStatus(
      device,
      "lifecycle-note",
      "resolved",
      baseScope,
    );
    expect(resolved.status).toBe("resolved");
    expect(typeof resolved.resolvedAt).toBe("number");
    expect(resolved.updatedAt).toBeGreaterThan(10);

    const reopened = setStoredAnnotationStatus(
      device,
      "lifecycle-note",
      "open",
      baseScope,
    );
    expect(reopened.status).toBe("open");
    expect(reopened.resolvedAt).toBeUndefined();
    expect(listStoredAnnotations(device, baseScope).find(
      (entry) => entry.id === "lifecycle-note",
    )).toEqual(reopened);
  });
});
