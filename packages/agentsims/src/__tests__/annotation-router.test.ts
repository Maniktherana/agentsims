import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
import { legacyAnnotationScope, type AnnotationScope } from "../annotations/model";
import { AnnotationRouter } from "../annotations/router";

type RouterResponse = {
  status: number;
  body: string;
};

async function request(
  router: AnnotationRouter,
  device: string,
  options: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<RouterResponse> {
  const req = new EventEmitter() as IncomingMessage;
  req.method = options.method;
  req.url = options.url;
  req.headers = options.headers ?? {};

  let status = 0;
  let responseBody = "";
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => { finish = resolve; });
  const res = {
    writeHead(nextStatus: number) {
      status = nextStatus;
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk) responseBody += chunk.toString();
      finish();
      return this;
    },
  } as unknown as ServerResponse;

  const handled = router.handle(req, res, device);
  if (options.body !== undefined) req.emit("data", Buffer.from(JSON.stringify(options.body)));
  req.emit("end");
  expect(await handled).toBe(true);
  await finished;
  return { status, body: responseBody };
}

describe("AnnotationRouter", () => {
  const device = `annotation-test-${process.pid}-${Date.now()}`;
  const router = new AnnotationRouter("/preview");
  const host = "127.0.0.1:3200";
  const origin = `http://${host}`;

  test("owns annotation persistence behind one route interface", async () => {
    const endpoint = "/preview/annotations";
    const annotation = { id: "note-1", note: "Align the composer" };

    const created = await request(router, device, {
      method: "POST",
      url: endpoint,
      headers: { "content-type": "application/json", origin, host },
      body: annotation,
    });
    expect(created.status).toBe(201);
    expect(JSON.parse(created.body)).toEqual({
      ok: true,
      annotation: {
        ...annotation,
        scope: legacyAnnotationScope(device),
        status: "open",
      },
    });

    const listed = await request(router, device, { method: "GET", url: endpoint });
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.body)).toEqual({
      device,
      annotations: [{
        ...annotation,
        scope: legacyAnnotationScope(device),
        status: "open",
      }],
    });

    const removed = await request(router, device, {
      method: "DELETE",
      url: `${endpoint}?id=note-1`,
      headers: { origin, host },
    });
    expect(removed.status).toBe(200);
    expect(JSON.parse(removed.body)).toEqual({ ok: true, annotations: [] });
  });

  test("rejects cross-origin writes", async () => {
    const response = await request(router, device, {
      method: "POST",
      url: "/preview/annotations",
      headers: {
        "content-type": "application/json",
        origin: "https://example.invalid",
        host,
      },
      body: { id: "blocked" },
    });
    expect(response.status).toBe(403);
  });

  test("isolates scoped records while legacy device-only reads remain compatible", async () => {
    const endpoint = "/preview/annotations";
    const firstScope: AnnotationScope = {
      projectId: "router-project",
      bundleId: "com.example.router",
      sessionId: "first",
      captureDeviceId: device,
      capturePlatform: "ios",
    };
    const secondScope: AnnotationScope = {
      ...firstScope,
      sessionId: "second",
      route: "/details",
    };
    const scopedUrl = (scope: AnnotationScope) => {
      const params = new URLSearchParams({
        projectId: scope.projectId,
        bundleId: scope.bundleId,
        sessionId: scope.sessionId,
        captureDeviceId: scope.captureDeviceId,
        capturePlatform: scope.capturePlatform,
      });
      if (scope.route) params.set("route", scope.route);
      return `${endpoint}?${params}`;
    };

    await request(router, device, {
      method: "POST",
      url: scopedUrl(firstScope),
      headers: { "content-type": "application/json", origin, host },
      body: { id: "first-note", note: "First" },
    });
    await request(router, device, {
      method: "POST",
      url: scopedUrl(secondScope),
      headers: { "content-type": "application/json", origin, host },
      body: { id: "second-note", note: "Second" },
    });

    const scoped = await request(router, device, {
      method: "GET",
      url: scopedUrl(firstScope),
    });
    expect(JSON.parse(scoped.body).annotations.map(
      (annotation: { id: string }) => annotation.id,
    )).toEqual(["first-note"]);

    const all = await request(router, device, { method: "GET", url: endpoint });
    expect(JSON.parse(all.body).annotations.map(
      (annotation: { id: string }) => annotation.id,
    ).sort()).toEqual(["first-note", "second-note"]);

    const mismatched = await request(router, device, {
      method: "POST",
      url: scopedUrl(firstScope),
      headers: { "content-type": "application/json", origin, host },
      body: { id: "mismatched-note", scope: secondScope },
    });
    expect(mismatched.status).toBe(400);

    await request(router, device, {
      method: "DELETE",
      url: endpoint,
      headers: { origin, host },
    });
  });
});
