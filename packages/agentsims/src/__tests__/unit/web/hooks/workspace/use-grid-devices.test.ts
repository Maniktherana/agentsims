import { describe, expect, test } from "bun:test";
import { LatestGridRequest } from "../../../../../web/hooks/workspace/use-grid-devices";

describe("LatestGridRequest", () => {
  test("rejects an older catalog completion after a newer request begins", () => {
    const requests = new LatestGridRequest();
    const older = requests.begin();
    const newer = requests.begin();

    expect(requests.isCurrent(older)).toBe(false);
    expect(requests.isCurrent(newer)).toBe(true);
  });

  test("invalidates pending completions when the polling effect stops", () => {
    const requests = new LatestGridRequest();
    const pending = requests.begin();
    requests.invalidate();

    expect(requests.isCurrent(pending)).toBe(false);
  });

  test("the polling hook preserves its last good catalog on transient errors", async () => {
    const source = await Bun.file(
      new URL("../../../../../web/hooks/workspace/use-grid-devices.ts", import.meta.url),
    ).text();
    const catchBody = source.match(/catch\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? "";

    expect(catchBody).not.toContain("setDevices([])");
    expect(source).toContain("requestsRef.current.isCurrent(request)");
  });
});
