import type { IncomingMessage, ServerResponse } from "http";
import type { Socket } from "net";

export type SimRequest = IncomingMessage;
export type SimResponse = ServerResponse;
export type SimNext = (error?: unknown) => Promise<void>;

export type SimMiddleware = {
  (request: SimRequest, response: SimResponse, next?: SimNext): Promise<void>;
  handleUpgrade(request: SimRequest, socket: Socket, head: Buffer): void;
};

export type RouteContext = {
  request: SimRequest;
  response: SimResponse;
  basePath: string;
  rawUrl: string;
  pathname: string;
  selectedDevice: string | null;
};
