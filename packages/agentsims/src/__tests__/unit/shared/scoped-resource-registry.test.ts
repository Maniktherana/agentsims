import { describe, expect, test } from "bun:test";
import { ScopedResourceRegistry } from "../../../shared/scoped-resource-registry";

describe("ScopedResourceRegistry", () => {
  test("reuses one resource per key and releases each resource once", async () => {
    const released: string[] = [];
    const registry = new ScopedResourceRegistry(
      (key: string) => ({ key }),
      (resource) => released.push(resource.key),
    );

    expect(registry.get("ios")).toBe(registry.get("ios"));
    expect(registry.get("android")).not.toBe(registry.get("ios"));

    await registry.close("ios");
    await registry.closeAll();
    expect(released).toEqual(["ios", "android"]);
  });
});
