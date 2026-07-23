import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  AnnotationEntry,
  AnnotationKind,
  AxElement,
  AxSnapshot,
} from "../../model";
import {
  AnnotationPinMarker,
  annotationPinPositionStyle,
  createAnnotationPinLayouts,
} from "./annotation-pins";

const noop = () => {};

function element(
  id: string,
  frame: AxElement["frame"],
  path = `/0/${id}`,
): AxElement {
  return {
    id,
    path,
    label: id,
    value: "",
    role: "button",
    type: "ReactViewGroup",
    enabled: true,
    frame,
  };
}

function annotation({
  id,
  kind = "element",
  target = null,
  elements,
  bounds,
}: {
  id: string;
  kind?: AnnotationKind;
  target?: AxElement | null;
  elements?: AxElement[];
  bounds?: AnnotationEntry["bounds"];
}): AnnotationEntry {
  return {
    id,
    kind,
    elementKey: null,
    element: target,
    ...(elements ? { elements } : {}),
    ...(bounds ? { bounds } : {}),
    note: `Note ${id}`,
    severity: "suggestion",
    status: "open",
    createdAt: 1,
    updatedAt: 1,
  };
}

function snapshot(
  width: number,
  height: number,
  elements: AxElement[] = [],
): AxSnapshot {
  return {
    screen: { width, height },
    elements,
  };
}

describe("annotation pin layout", () => {
  test("re-resolves a saved AX target against the current orientation snapshot", () => {
    const saved = element("composer", {
      x: 40,
      y: 700,
      width: 300,
      height: 80,
    });
    const current = element("composer", {
      x: 540,
      y: 40,
      width: 240,
      height: 80,
    });

    const result = createAnnotationPinLayouts(
      [annotation({ id: "rotated", target: saved })],
      snapshot(844, 390, [current]),
      { width: 390, height: 844 },
    );

    expect(result?.screen).toEqual({ width: 844, height: 390 });
    expect(result?.pins[0]?.frames).toEqual([current.frame]);
    expect(result?.pins[0]?.anchor).toEqual({ x: 780, y: 40 });
  });

  test("keeps a pin attached when the AX path changes", () => {
    const saved = element(
      "composer",
      { x: 20, y: 700, width: 300, height: 80 },
      "/0/old/composer",
    );
    const current = element(
      "composer",
      { x: 20, y: 360, width: 300, height: 80 },
      "/0/keyboard/composer",
    );

    const result = createAnnotationPinLayouts(
      [annotation({ id: "moving", target: saved })],
      snapshot(390, 844, [current]),
    );

    expect(result?.pins[0]?.frames).toEqual([current.frame]);
    expect(result?.pins[0]?.anchor).toEqual({ x: 320, y: 360 });
  });

  test("does not leave a stale pin behind when its target is off screen", () => {
    const saved = element(
      "composer",
      { x: 20, y: 700, width: 300, height: 80 },
    );
    const unrelated = element(
      "launcher",
      { x: 20, y: 40, width: 80, height: 80 },
    );

    const result = createAnnotationPinLayouts(
      [annotation({ id: "gone", target: saved })],
      snapshot(390, 844, [unrelated]),
    );

    expect(result?.pins).toEqual([]);
  });

  test("maps coordinates proportionally and clamps the marker inside phone edges", () => {
    const result = createAnnotationPinLayouts(
      [
        annotation({
          id: "edge-area",
          kind: "area",
          bounds: { x: -20, y: 80, width: 80, height: 50 },
        }),
      ],
      snapshot(100, 100),
    );
    const pin = result!.pins[0]!;

    expect(pin.frames).toEqual([{ x: 0, y: 80, width: 60, height: 20 }]);
    expect(pin.anchor).toEqual({ x: 60, y: 80 });
    expect(annotationPinPositionStyle(pin, result!.screen)).toEqual({
      left: "clamp(11px, 60%, calc(100% - 11px))",
      top: "clamp(11px, 80%, calc(100% - 11px))",
      transform: "translate(-50%, -50%)",
    });
  });

  test("anchors multi-target notes to the union and screen notes to a safe edge fallback", () => {
    const first = element("first", { x: 10, y: 20, width: 20, height: 30 });
    const second = element("second", { x: 70, y: 60, width: 40, height: 50 });
    const result = createAnnotationPinLayouts(
      [
        annotation({
          id: "multi",
          kind: "multi",
          target: first,
          elements: [first, second],
        }),
        annotation({ id: "screen", kind: "screen" }),
        annotation({
          id: "offscreen",
          kind: "area",
          bounds: { x: 140, y: 140, width: 20, height: 20 },
        }),
      ],
      snapshot(100, 100),
    );

    expect(result?.pins[0]?.frames).toEqual([
      first.frame,
      { x: 70, y: 60, width: 30, height: 40 },
    ]);
    expect(result?.pins[0]?.anchor).toEqual({ x: 100, y: 20 });
    expect(result?.pins[1]?.anchor).toEqual({ x: 100, y: 0 });
    expect(result?.pins[2]?.frames).toEqual([]);
    expect(result?.pins[2]?.anchor).toEqual({ x: 100, y: 0 });
  });

  test("keeps same-element annotations independently identified and visibly stacked", () => {
    const target = element("shared", { x: 60, y: 30, width: 30, height: 20 });
    const entries = [
      annotation({ id: "note-a", target }),
      annotation({ id: "note-b", target }),
      annotation({ id: "note-c", target }),
      annotation({ id: "note-d", target }),
    ];
    const result = createAnnotationPinLayouts(entries, snapshot(100, 100));

    expect(result?.pins.map((pin) => pin.annotation.id)).toEqual([
      "note-a",
      "note-b",
      "note-c",
      "note-d",
    ]);
    expect(result?.pins.map((pin) => pin.marker)).toEqual([1, 2, 3, 4]);
    expect(result?.pins.map((pin) => pin.stackIndex)).toEqual([0, 1, 2, 3]);
    expect(result?.pins.map(({ offsetX, offsetY }) => [offsetX, offsetY])).toEqual([
      [0, 0],
      [-20, 0],
      [-40, 0],
      [0, 20],
    ]);
  });

  test("exposes compact selected and hovered marker states by annotation id", () => {
    const target = element("target", { x: 10, y: 20, width: 30, height: 40 });
    const result = createAnnotationPinLayouts(
      [annotation({ id: "note-42", target })],
      snapshot(100, 200),
    )!;
    const selectedHtml = renderToStaticMarkup(
      <AnnotationPinMarker
        layout={result.pins[0]!}
        screen={result.screen}
        active
        hovered={false}
        onOpen={noop}
        onHover={noop}
      />,
    );
    const hoveredHtml = renderToStaticMarkup(
      <AnnotationPinMarker
        layout={result.pins[0]!}
        screen={result.screen}
        active={false}
        hovered
        onOpen={noop}
        onHover={noop}
      />,
    );

    expect(selectedHtml).toContain('data-annotation-id="note-42"');
    expect(selectedHtml).toContain('data-annotation-marker="1"');
    expect(selectedHtml).toContain('data-annotation-state="selected"');
    expect(selectedHtml).toContain('aria-pressed="true"');
    expect(selectedHtml).toContain("h-[22px]");
    expect(selectedHtml).toContain("clamp(11px");
    expect(hoveredHtml).toContain('data-annotation-state="hovered"');
    expect(hoveredHtml).toContain('aria-pressed="false"');
  });
});
