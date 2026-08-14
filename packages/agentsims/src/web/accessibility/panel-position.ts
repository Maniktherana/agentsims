import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RESET_WORKSPACE_LAYOUT_EVENT } from "../workspace/layout-events";

const PANEL_DEFAULT_WIDTH = 540;
const PANEL_DEFAULT_HEIGHT = 520;
const PANEL_MIN_WIDTH = 460;
const PANEL_MIN_HEIGHT = 320;
const PANEL_MAX_WIDTH = 960;
const PANEL_MAX_HEIGHT = 760;
const PANEL_GAP = 16;
const PANEL_MARGIN = 12;

export interface AccessibilityPanelGeometry {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type AccessibilityPanelAnchorRect = Pick<
  DOMRect,
  "left" | "right" | "top" | "bottom"
>;

export interface SavedAccessibilityPanelGeometry {
  left: number;
  top: number;
  width?: number;
  height?: number;
}

export function clampAccessibilityPanelGeometry(
  geometry: AccessibilityPanelGeometry,
  viewportWidth: number,
  viewportHeight: number,
): AccessibilityPanelGeometry {
  const rightBoundary = viewportWidth - PANEL_MARGIN;
  const bottomBoundary = viewportHeight - PANEL_MARGIN;
  const availableWidth = Math.max(240, rightBoundary - PANEL_MARGIN);
  const availableHeight = Math.max(240, bottomBoundary - PANEL_MARGIN);
  const width = Math.min(
    Math.max(Math.min(PANEL_MIN_WIDTH, availableWidth), geometry.width),
    Math.min(PANEL_MAX_WIDTH, availableWidth),
  );
  const height = Math.min(
    Math.max(Math.min(PANEL_MIN_HEIGHT, availableHeight), geometry.height),
    Math.min(PANEL_MAX_HEIGHT, availableHeight),
  );
  return {
    left: Math.min(
      Math.max(PANEL_MARGIN, geometry.left),
      Math.max(PANEL_MARGIN, rightBoundary - width),
    ),
    top: Math.min(
      Math.max(PANEL_MARGIN, bottomBoundary - height),
      Math.max(PANEL_MARGIN, geometry.top),
    ),
    width,
    height,
  };
}

export function moveAccessibilityPanelGeometry(
  geometry: AccessibilityPanelGeometry,
  deltaX: number,
  deltaY: number,
  viewportWidth: number,
  viewportHeight: number,
): AccessibilityPanelGeometry {
  return clampAccessibilityPanelGeometry(
    { ...geometry, left: geometry.left + deltaX, top: geometry.top + deltaY },
    viewportWidth,
    viewportHeight,
  );
}

export function resizeAccessibilityPanelGeometry(
  geometry: AccessibilityPanelGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): AccessibilityPanelGeometry {
  return clampAccessibilityPanelGeometry(
    { ...geometry, width: geometry.width + deltaWidth, height: geometry.height + deltaHeight },
    viewportWidth,
    viewportHeight,
  );
}

export function resizeAccessibilityPanelGeometryFromPointer(
  geometry: AccessibilityPanelGeometry,
  start: { x: number; y: number },
  current: { x: number; y: number },
  viewportWidth: number,
  viewportHeight: number,
): AccessibilityPanelGeometry {
  return resizeAccessibilityPanelGeometry(
    geometry,
    current.x - start.x,
    current.y - start.y,
    viewportWidth,
    viewportHeight,
  );
}

export function accessibilityPanelResizeDeltaForKey(
  key: string,
  coarse: boolean,
): [deltaWidth: number, deltaHeight: number] | null {
  const step = coarse ? 32 : 8;
  if (key === "ArrowRight") return [step, 0];
  if (key === "ArrowLeft") return [-step, 0];
  if (key === "ArrowDown") return [0, step];
  if (key === "ArrowUp") return [0, -step];
  return null;
}

export function parseAccessibilityPanelGeometry(
  value: string | null,
): SavedAccessibilityPanelGeometry | null {
  try {
    const parsed = JSON.parse(value ?? "null") as
      | Partial<SavedAccessibilityPanelGeometry>
      | null;
    if (!parsed || typeof parsed.left !== "number" || typeof parsed.top !== "number") {
      return null;
    }
    return {
      left: parsed.left,
      top: parsed.top,
      ...(typeof parsed.width === "number" ? { width: parsed.width } : {}),
      ...(typeof parsed.height === "number" ? { height: parsed.height } : {}),
    };
  } catch {
    return null;
  }
}

export function accessibilityPanelStorageKey(deviceId: string) {
  return `agentsims:ax-panel:${deviceId}`;
}

export function readAccessibilityPanelGeometry(
  deviceId: string,
  storage: Pick<Storage, "getItem"> = window.localStorage,
): SavedAccessibilityPanelGeometry | null {
  try {
    return parseAccessibilityPanelGeometry(
      storage.getItem(accessibilityPanelStorageKey(deviceId)),
    );
  } catch {
    return null;
  }
}

export function clearAccessibilityPanelGeometry(
  deviceId: string,
  storage: Pick<Storage, "removeItem">,
) {
  try {
    storage.removeItem(accessibilityPanelStorageKey(deviceId));
  } catch {}
}

function writeAccessibilityPanelGeometry(
  deviceId: string,
  geometry: AccessibilityPanelGeometry,
) {
  try {
    window.localStorage.setItem(
      accessibilityPanelStorageKey(deviceId),
      JSON.stringify(geometry),
    );
  } catch {}
}

function anchorRect(element: HTMLElement | null): AccessibilityPanelAnchorRect | null {
  const rect = element?.getBoundingClientRect();
  return rect
    ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    : null;
}

export function defaultAccessibilityPanelGeometryForRect(
  rect: AccessibilityPanelAnchorRect | null,
  viewportWidth: number,
  viewportHeight: number,
): AccessibilityPanelGeometry {
  return clampAccessibilityPanelGeometry(
    {
      left: rect ? rect.right + PANEL_GAP : PANEL_MARGIN,
      top: rect?.top ?? PANEL_MARGIN,
      width: PANEL_DEFAULT_WIDTH,
      height: PANEL_DEFAULT_HEIGHT,
    },
    viewportWidth,
    viewportHeight,
  );
}

export function resetAccessibilityPanelGeometryForRect(
  deviceId: string,
  rect: AccessibilityPanelAnchorRect | null,
  viewportWidth: number,
  viewportHeight: number,
  storage: Pick<Storage, "removeItem">,
): AccessibilityPanelGeometry {
  clearAccessibilityPanelGeometry(deviceId, storage);
  return defaultAccessibilityPanelGeometryForRect(rect, viewportWidth, viewportHeight);
}

export function useAccessibilityPanelPosition(
  anchor: HTMLElement | null,
  open: boolean,
  deviceId: string,
) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const geometryRef = useRef<AccessibilityPanelGeometry>({
    left: PANEL_MARGIN,
    top: PANEL_MARGIN,
    width: PANEL_DEFAULT_WIDTH,
    height: PANEL_DEFAULT_HEIGHT,
  });
  const [style, setStyle] = useState<CSSProperties>({
    position: "fixed",
    ...geometryRef.current,
    zIndex: 64,
  });

  const apply = useCallback((geometry: AccessibilityPanelGeometry, persist = false) => {
    geometryRef.current = geometry;
    setStyle({ position: "fixed", ...geometry, zIndex: 64 });
    if (persist) writeAccessibilityPanelGeometry(deviceId, geometry);
  }, [deviceId]);

  useLayoutEffect(() => {
    if (!open) return;
    const fallback = defaultAccessibilityPanelGeometryForRect(
      anchorRect(anchor),
      window.innerWidth,
      window.innerHeight,
    );
    const saved = readAccessibilityPanelGeometry(deviceId);
    apply(clampAccessibilityPanelGeometry({
      left: saved?.left ?? fallback.left,
      top: saved?.top ?? fallback.top,
      width: saved?.width ?? fallback.width,
      height: saved?.height ?? fallback.height,
    }, window.innerWidth, window.innerHeight));
  }, [anchor, apply, deviceId, open]);

  useEffect(() => {
    if (!open) return;
    const resize = () => apply(
      clampAccessibilityPanelGeometry(
        geometryRef.current,
        window.innerWidth,
        window.innerHeight,
      ),
    );
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [apply, open]);

  useEffect(() => {
    const reset = () => {
      clearAccessibilityPanelGeometry(deviceId, window.localStorage);
      if (!open) return;
      apply(defaultAccessibilityPanelGeometryForRect(
        anchorRect(anchor),
        window.innerWidth,
        window.innerHeight,
      ));
    };
    window.addEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
    return () => window.removeEventListener(RESET_WORKSPACE_LAYOUT_EVENT, reset);
  }, [anchor, apply, deviceId, open]);

  const onMovePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    const start = geometryRef.current;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (next: PointerEvent) => apply(moveAccessibilityPanelGeometry(
      start,
      next.clientX - startX,
      next.clientY - startY,
      window.innerWidth,
      window.innerHeight,
    ));
    const finish = (next: PointerEvent) => {
      move(next);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      writeAccessibilityPanelGeometry(deviceId, geometryRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  }, [apply, deviceId]);

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const start = geometryRef.current;
    const startPoint = { x: event.clientX, y: event.clientY };
    const move = (next: PointerEvent) => apply(resizeAccessibilityPanelGeometryFromPointer(
      start,
      startPoint,
      { x: next.clientX, y: next.clientY },
      window.innerWidth,
      window.innerHeight,
    ));
    const finish = (next: PointerEvent) => {
      move(next);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", finish, true);
      window.removeEventListener("pointercancel", finish, true);
      writeAccessibilityPanelGeometry(deviceId, geometryRef.current);
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", finish, true);
    window.addEventListener("pointercancel", finish, true);
  }, [apply, deviceId]);

  const onResizeKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const delta = accessibilityPanelResizeDeltaForKey(event.key, event.shiftKey);
    if (!delta) return;
    event.preventDefault();
    apply(resizeAccessibilityPanelGeometry(
      geometryRef.current,
      ...delta,
      window.innerWidth,
      window.innerHeight,
    ), true);
  }, [apply]);

  return {
    panelRef,
    style,
    onMovePointerDown,
    onResizePointerDown,
    onResizeKeyDown,
  };
}
