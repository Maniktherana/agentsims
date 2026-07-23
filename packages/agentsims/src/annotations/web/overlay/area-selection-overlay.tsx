import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AxRect } from "../../model";
import { useAxSelectionContext } from "../state/device-annotation-state";

interface Point {
  x: number;
  y: number;
}

function pointInElement(event: ReactPointerEvent<HTMLDivElement>): Point {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1),
    y: Math.min(Math.max((event.clientY - rect.top) / rect.height, 0), 1),
  };
}

function selectionRect(start: Point, end: Point): AxRect {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function AreaSelectionOverlay({
  screen,
}: {
  screen: { width: number; height: number };
}) {
  const { openAreaComposer } = useAxSelectionContext();
  const [selection, setSelection] = useState<{ start: Point; end: Point } | null>(null);
  const pointerId = useRef<number | null>(null);

  if (screen.width <= 0 || screen.height <= 0) return null;

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId || !selection) return;
    const end = pointInElement(event);
    const normalized = selectionRect(selection.start, end);
    pointerId.current = null;
    setSelection(null);
    if (normalized.width < 0.015 || normalized.height < 0.015) return;
    openAreaComposer({
      x: Math.round(normalized.x * screen.width),
      y: Math.round(normalized.y * screen.height),
      width: Math.round(normalized.width * screen.width),
      height: Math.round(normalized.height * screen.height),
    });
  };

  const rect = selection ? selectionRect(selection.start, selection.end) : null;
  return (
    <div
      className="absolute inset-0 z-10 cursor-crosshair touch-none pointer-events-auto"
      aria-label="Select annotation area"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const point = pointInElement(event);
        pointerId.current = event.pointerId;
        setSelection({ start: point, end: point });
      }}
      onPointerMove={(event) => {
        if (pointerId.current !== event.pointerId) return;
        const end = pointInElement(event);
        setSelection((current) => current ? { ...current, end } : null);
      }}
      onPointerUp={finish}
      onPointerCancel={() => {
        pointerId.current = null;
        setSelection(null);
      }}
    >
      {rect && (
        <div
          className="absolute rounded-[3px] border border-[#60a5fa] bg-[#3b82f6]/18 shadow-[0_0_0_1px_rgba(0,0,0,0.28)] pointer-events-none"
          style={{
            left: `${rect.x * 100}%`,
            top: `${rect.y * 100}%`,
            width: `${rect.width * 100}%`,
            height: `${rect.height * 100}%`,
          }}
        />
      )}
    </div>
  );
}
