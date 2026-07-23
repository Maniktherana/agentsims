import { describe, expect, test } from "bun:test";
import type { AxElement } from "../annotations/model";
import {
  selectRenderedAxTargetEntries,
  type AxOverlayTargetEntry,
} from "../annotations/web/overlay/ax-dom-overlay";

function entry(index: number): AxOverlayTargetEntry {
  const element: AxElement = {
    id: `node-${index}`,
    path: `0.${index}`,
    label: `Node ${index}`,
    value: "",
    role: "button",
    type: "Button",
    enabled: true,
    frame: { x: index * 2, y: index * 2, width: 40, height: 20 },
  };
  return {
    element,
    index,
    key: `${element.id}@${element.path}`,
  };
}

describe("AX overlay render bounds", () => {
  const entries = Array.from({ length: 500 }, (_, index) => entry(index));

  test("passive inspection mounts only highlighted and selected targets", () => {
    const highlightedKey = entries[42]!.key;
    const selectedKey = entries[84]!.key;
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey,
      selectedKeys: new Set([selectedKey]),
    });

    expect(rendered.map((candidate) => candidate.key)).toEqual([
      highlightedKey,
      selectedKey,
    ]);
  });

  test("deduplicates a target that is both highlighted and selected", () => {
    const key = entries[12]!.key;
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: key,
      selectedKeys: new Set([key]),
    });

    expect(rendered).toEqual([entries[12]]);
  });

  test("keeps all hit targets while selection is interactive", () => {
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: true,
      inspecting: true,
      showAllOutlines: false,
      highlightedKey: null,
      selectedKeys: new Set(),
    });

    expect(rendered).toBe(entries);
  });

  test("keeps all nodes when Show all is explicitly enabled", () => {
    const rendered = selectRenderedAxTargetEntries(entries, {
      interactive: false,
      inspecting: true,
      showAllOutlines: true,
      highlightedKey: null,
      selectedKeys: new Set(),
    });

    expect(rendered).toBe(entries);
  });
});
