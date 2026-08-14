import { exec, type ExecException } from "child_process";
import { bearerToken, hasSameOrigin, isJsonContentType, safeEqualString } from "../request";
import { sendJson } from "../response";
import type { RouteContext } from "../types";

type ExecRequestBody = { command?: string };

export function createExecRoute(execToken: string) {
  return async function handleExecRoute(context: RouteContext): Promise<boolean> {
    const { request, response, basePath, pathname } = context;
    if (
      (pathname !== `${basePath}/exec` && pathname !== `${basePath}/exec/`) ||
      request.method !== "POST"
    ) {
      return false;
    }

    if (!isJsonContentType(request.headers["content-type"])) {
      sendJson(response, 415, {
        stdout: "",
        stderr: "Unsupported Media Type",
        exitCode: 1,
      });
      return true;
    }
    if (!hasSameOrigin(request)) {
      sendJson(response, 403, {
        stdout: "",
        stderr: "Cross-origin request blocked",
        exitCode: 1,
      });
      return true;
    }
    const token = bearerToken(request);
    if (!token || !safeEqualString(token, execToken)) {
      sendJson(response, 401, { stdout: "", stderr: "Unauthorized", exitCode: 1 });
      return true;
    }

    let body = "";
    let aborted = false;
    request.on("data", (chunk: Buffer | string) => {
      body += typeof chunk === "string" ? chunk : chunk.toString();
      if (body.length <= 4 * 1024 * 1024) return;
      aborted = true;
      sendJson(response, 413, { stdout: "", stderr: "Payload Too Large", exitCode: 1 });
      request.destroy();
    });
    request.on("end", () => {
      if (aborted) return;
      let command = "";
      try {
        command = (JSON.parse(body) as ExecRequestBody).command ?? "";
      } catch {}
      if (!command) {
        sendJson(response, 400, { stdout: "", stderr: "Missing command", exitCode: 1 });
        return;
      }
      exec(command, { maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
        sendJson(response, 200, {
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          exitCode: error ? ((error as ExecException).code ?? 1) : 0,
        });
      });
    });
    return true;
  };
}
