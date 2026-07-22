import { describe, expect, test } from "bun:test";
import { EventEmitter } from "events";
import type { IncomingMessage, ServerResponse } from "http";
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
    expect(JSON.parse(created.body)).toEqual({ ok: true, annotation });

    const listed = await request(router, device, { method: "GET", url: endpoint });
    expect(listed.status).toBe(200);
    expect(JSON.parse(listed.body)).toEqual({ device, annotations: [annotation] });

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
});
