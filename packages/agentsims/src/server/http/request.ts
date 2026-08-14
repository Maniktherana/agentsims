import { timingSafeEqual } from "crypto";
import type { SimRequest } from "./types";

export function queryDevice(rawUrl: string): string | null {
  const queryIndex = rawUrl.indexOf("?");
  if (queryIndex === -1) return null;
  return new URLSearchParams(rawUrl.slice(queryIndex + 1)).get("device");
}

export function hostForRequest(request: SimRequest): string | undefined {
  const host = request.headers.host;
  if (host) return host;
  const port = request.socket.localPort;
  return port ? `localhost:${port}` : undefined;
}

export function publicPortForRequest(request: SimRequest): number {
  const forwarded = request.headers["x-agentsims-public-port"];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const port = Number(value);
    if (port > 0 && port <= 65_535) return port;
  }
  return request.socket.localPort ?? 0;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function forwardedProtocol(request: SimRequest): string | undefined {
  return firstHeaderValue(request.headers["x-forwarded-proto"])
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
}

export function websocketProtocolForRequest(request: SimRequest): "ws" | "wss" {
  return forwardedProtocol(request) === "https" ? "wss" : "ws";
}

export function httpProtocolForRequest(request: SimRequest): "http" | "https" {
  return forwardedProtocol(request) === "https" ? "https" : "http";
}

export function safeEqualString(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  return value.split(";", 1)[0]!.trim().toLowerCase() === "application/json";
}

export function hasSameOrigin(request: SimRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

export function bearerToken(request: SimRequest): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? "");
  return match?.[1]?.trim() ?? null;
}
