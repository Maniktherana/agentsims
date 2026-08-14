import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useAxSelectionContext,
  useAxSnapshotContext,
} from "./provider";
import type { AxHighlightOrigin } from "../../accessibility/state";
import type { AxElement } from "../../../accessibility/model";
import {
  meaningfulAxTargetElements,
  axElementKey,
  clampAxFrameForScreen,
} from "../../accessibility/ax";
import { AxTarget } from "./target";

function axElementHoverLabel(element: AxElement): string {
  const generatedLabel = /^ags_[a-z0-9_-]+$/i.test((element.label || "").trim());
  return (
    (!generatedLabel ? element.label : "") ||
    element.source?.componentName ||
    element.source?.elementName ||
    element.role ||
    element.type ||
    "Accessibility element"
  );
}

interface HoverPosition {
  left: number;
  top: number;
  above: boolean;
}

interface OverlayViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface AxOverlayTargetEntry {
  element: AxElement;
  index: number;
  key: string;
}

export interface AxOverlayTargetProjection {
  visibleEntries: AxOverlayTargetEntry[];
  eligibleEntries: AxOverlayTargetEntry[];
  previewKeyByRawKey: ReadonlyMap<string, string>;
}

function isDirectSourceMatch(element: AxElement): boolean {
  const reason = element.source?.matchReason;
  return reason !== "ancestor-owner" &&
    reason !== "nearby-visible-text" &&
    reason !== "nearby-accessibility-label" &&
    reason !== "nearby-placeholder" &&
    reason !== "nearby-carrier-text" &&
    reason !== "nearby-host-type";
}

function hasNativeAxAction(element: AxElement): boolean {
  const role = `${element.role} ${element.type}`.toLowerCase();
  const traits = (element.traits ?? []).map((trait) => trait.toLowerCase());
  return traits.some((trait) =>
    trait.includes("clickable") ||
    trait.includes("long press") ||
    trait.includes("button") ||
    trait.includes("link") ||
    trait.includes("adjustable")
  ) ||
    role.includes("button") ||
    role.includes("edittext") ||
    role.includes("textfield") ||
    role.includes("text field") ||
    role.includes("switch") ||
    role.includes("checkbox") ||
    role.includes("radiobutton") ||
    role.includes("radio button") ||
    role.includes("spinner") ||
    role.includes("seekbar") ||
    role.includes("slider") ||
    role.includes("link") ||
    role.includes("menuitem");
}

function hasDirectSourceAction(element: AxElement): boolean {
  const sourceName = isDirectSourceMatch(element)
    ? (element.source?.elementName ?? "").toLowerCase()
    : "";
  return sourceName.includes("pressable") ||
    sourceName.includes("touchable") ||
    sourceName.includes("button") ||
    sourceName.includes("input");
}

/** True for a control the user can actually act on, not visual descendants. */
export function isActionableAxOverlayElement(element: AxElement): boolean {
  return hasNativeAxAction(element) || hasDirectSourceAction(element);
}

function parentAxPath(path: string): string | null {
  const separator = Math.max(path.lastIndexOf("."), path.lastIndexOf("/"));
  return separator > 0 ? path.slice(0, separator) : null;
}

function axPathDepth(path: string): number {
  return path.split(/[./]/).filter(Boolean).length;
}

function actionableSemanticRank(element: AxElement): number {
  const role = `${element.role} ${element.type}`.toLowerCase();
  if (
    role.includes("button") ||
    role.includes("edittext") ||
    role.includes("textfield") ||
    role.includes("text field") ||
    role.includes("switch") ||
    role.includes("checkbox") ||
    role.includes("radiobutton") ||
    role.includes("radio button") ||
    role.includes("spinner") ||
    role.includes("seekbar") ||
    role.includes("slider") ||
    role.includes("link") ||
    role.includes("menuitem")
  ) {
    return 3;
  }
  if (hasDirectSourceAction(element)) return 2;
  const traits = (element.traits ?? []).map((trait) => trait.toLowerCase());
  return traits.some((trait) =>
      trait.includes("button") ||
      trait.includes("link") ||
      trait.includes("adjustable") ||
      trait.includes("long press")
    )
    ? 2
    : 1;
}

function compareDuplicateTargetPreference(
  left: AxOverlayTargetEntry,
  right: AxOverlayTargetEntry,
): number {
  const rankDifference =
    actionableSemanticRank(left.element) - actionableSemanticRank(right.element);
  if (rankDifference !== 0) return -rankDifference;
  const depthDifference =
    axPathDepth(left.element.path) - axPathDepth(right.element.path);
  if (depthDifference !== 0) return -depthDifference;
  return left.index - right.index;
}

function axFramesAreDuplicateBounds(
  left: AxElement["frame"],
  right: AxElement["frame"],
  screen: { width: number; height: number },
): boolean {
  const leftFrame = clampAxFrameForScreen(left, screen);
  const rightFrame = clampAxFrameForScreen(right, screen);
  if (!leftFrame || !rightFrame) return false;

  // Native AX frames are quantized in screen coordinates. Tolerate one native
  // coordinate unit on each rendered edge, but require at least 90% overlap so
  // a real nested action with a smaller hit area remains independently usable.
  const edgeEpsilon = 1 + Number.EPSILON;
  const leftRight = leftFrame.x + leftFrame.width;
  const rightRight = rightFrame.x + rightFrame.width;
  const leftBottom = leftFrame.y + leftFrame.height;
  const rightBottom = rightFrame.y + rightFrame.height;
  if (
    Math.abs(leftFrame.x - rightFrame.x) > edgeEpsilon ||
    Math.abs(leftFrame.y - rightFrame.y) > edgeEpsilon ||
    Math.abs(leftRight - rightRight) > edgeEpsilon ||
    Math.abs(leftBottom - rightBottom) > edgeEpsilon
  ) {
    return false;
  }

  const intersectionWidth = Math.max(
    0,
    Math.min(leftRight, rightRight) - Math.max(leftFrame.x, rightFrame.x),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(leftBottom, rightBottom) - Math.max(leftFrame.y, rightFrame.y),
  );
  const intersectionArea = intersectionWidth * intersectionHeight;
  const unionArea =
    leftFrame.width * leftFrame.height +
    rightFrame.width * rightFrame.height -
    intersectionArea;
  return unionArea > 0 && intersectionArea / unionArea >= 0.9;
}

function collapseDuplicateAxOverlayTargets(
  entries: AxOverlayTargetEntry[],
  screen: { width: number; height: number },
): {
  entries: AxOverlayTargetEntry[];
  retainedKeyByCandidateKey: ReadonlyMap<string, string>;
} {
  const duplicateNeighbors = entries.map(() => new Set<number>());
  const candidateIndexByPath = new Map(
    entries.map((entry, index) => [entry.element.path, index]),
  );
  for (let descendantIndex = 0; descendantIndex < entries.length; descendantIndex += 1) {
    const descendant = entries[descendantIndex]!;
    let ancestorPath = parentAxPath(descendant.element.path);
    while (ancestorPath) {
      const ancestorIndex = candidateIndexByPath.get(ancestorPath);
      const ancestor = ancestorIndex === undefined
        ? null
        : entries[ancestorIndex]!;
      if (
        ancestor &&
        axFramesAreDuplicateBounds(
          ancestor.element.frame,
          descendant.element.frame,
          screen,
        )
      ) {
        duplicateNeighbors[ancestorIndex!]!.add(descendantIndex);
        duplicateNeighbors[descendantIndex]!.add(ancestorIndex!);
      }
      ancestorPath = parentAxPath(ancestorPath);
    }
  }

  // Build deterministic winner-centered groups instead of connected
  // components. Every collapsed member must directly satisfy the bounds
  // predicate against its retained winner; near-match chains cannot widen the
  // tolerated edge drift transitively.
  const preferredCandidateIndexes = entries
    .map((_, index) => index)
    .sort((left, right) =>
      compareDuplicateTargetPreference(entries[left]!, entries[right]!)
    );
  const retainedIndexByCandidateIndex = entries.map(() => -1);
  for (const winnerIndex of preferredCandidateIndexes) {
    if (retainedIndexByCandidateIndex[winnerIndex] !== -1) continue;
    retainedIndexByCandidateIndex[winnerIndex] = winnerIndex;
    for (const candidateIndex of duplicateNeighbors[winnerIndex]!) {
      if (retainedIndexByCandidateIndex[candidateIndex] === -1) {
        retainedIndexByCandidateIndex[candidateIndex] = winnerIndex;
      }
    }
  }

  const retainedKeyByCandidateKey = new Map<string, string>();
  for (let index = 0; index < entries.length; index += 1) {
    retainedKeyByCandidateKey.set(
      entries[index]!.key,
      entries[retainedIndexByCandidateIndex[index]!]!.key,
    );
  }
  const retainedKeys = new Set(
    retainedIndexByCandidateIndex.map((index) => entries[index]!.key),
  );
  return {
    entries: entries.filter((entry) => retainedKeys.has(entry.key)),
    retainedKeyByCandidateKey,
  };
}

export function buildAxOverlayTargetEntries(
  elements: AxElement[],
  screen: { width: number; height: number },
  { actionableOnly = true }: { actionableOnly?: boolean } = {},
): AxOverlayTargetProjection {
  const visibleEntries = elements.flatMap((element, index) =>
    clampAxFrameForScreen(element.frame, screen)
      ? [{ element, index, key: axElementKey(element) }]
      : []
  );
  const meaningfulKeys = actionableOnly
    ? null
    : new Set(meaningfulAxTargetElements(elements, screen).map(axElementKey));
  const actionCandidates = actionableOnly
    ? visibleEntries.filter((entry) => {
        const element = entry.element;
        if (element.visibleToUser === false) return false;
        const areaRatio = (element.frame.width * element.frame.height) /
          Math.max(1, screen.width * screen.height);
        return areaRatio <= 0.72 && isActionableAxOverlayElement(element);
      })
    : [];
  const actionCandidateByPath = new Map(
    actionCandidates.map((entry) => [entry.element.path, entry]),
  );
  const undeduplicatedEntries = actionableOnly
    ? actionCandidates.filter((entry) => {
        // Source ownership can be inherited by visual children. If a source-only
        // candidate sits under a real actionable ancestor, the ancestor owns the
        // one phone box. Native actionable descendants remain independently
        // targetable.
        if (hasNativeAxAction(entry.element)) return true;
        let path = parentAxPath(entry.element.path);
        while (path) {
          if (actionCandidateByPath.has(path)) return false;
          path = parentAxPath(path);
        }
        return true;
      })
    : visibleEntries.filter((entry) => meaningfulKeys?.has(entry.key));
  const collapsedTargets = actionableOnly
    ? collapseDuplicateAxOverlayTargets(undeduplicatedEntries, screen)
    : {
        entries: undeduplicatedEntries,
        retainedKeyByCandidateKey: new Map(
          undeduplicatedEntries.map((entry) => [entry.key, entry.key]),
        ),
      };
  const eligibleEntries = collapsedTargets.entries;
  const eligibleByKey = new Map(
    eligibleEntries.map((entry) => [entry.key, entry]),
  );
  const eligibleByPath = new Map(
    eligibleEntries.map((entry) => [entry.element.path, entry]),
  );
  const projectedTargetByCandidatePath = new Map(
    undeduplicatedEntries.flatMap((entry) => {
      const retainedKey = collapsedTargets.retainedKeyByCandidateKey.get(entry.key);
      const retainedEntry = retainedKey ? eligibleByKey.get(retainedKey) : null;
      return retainedEntry ? [[entry.element.path, retainedEntry] as const] : [];
    }),
  );
  const previewKeyByRawKey = new Map<string, string>();
  for (const entry of visibleEntries) {
    let path: string | null = entry.element.path;
    while (path) {
      const target = projectedTargetByCandidatePath.get(path) ??
        eligibleByPath.get(path);
      if (target) {
        previewKeyByRawKey.set(entry.key, target.key);
        break;
      }
      path = parentAxPath(path);
    }
  }
  return {
    visibleEntries,
    eligibleEntries,
    previewKeyByRawKey,
  };
}

export function selectRenderedAxTargetEntries(
  entries: AxOverlayTargetEntry[],
  {
    interactive,
    inspecting,
    showAllOutlines,
    highlightedKey,
    selectedKeys,
  }: {
    interactive: boolean;
    inspecting: boolean;
    showAllOutlines: boolean;
    highlightedKey: string | null;
    selectedKeys: ReadonlySet<string>;
  },
): AxOverlayTargetEntry[] {
  const keys = new Set<string>();
  if (highlightedKey) keys.add(highlightedKey);
  for (const key of selectedKeys) keys.add(key);
  // `entries` is already the meaningful/actionable overlay set. Resolve active
  // state against that set too: selecting a raw tree carrier must not smuggle a
  // hidden, screen-sized, or otherwise ineligible node back onto the phone.
  const entriesByKey = new Map(entries.map((entry) => [entry.key, entry]));
  const activeEntries = [...keys].flatMap((key) => {
    const entry = entriesByKey.get(key);
    return entry ? [entry] : [];
  });
  if (!interactive && !(inspecting && showAllOutlines)) return activeEntries;

  return entries;
}

export function projectAxOverlayTargetKeys(
  rawKeys: ReadonlySet<string>,
  previewKeyByRawKey: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  return new Set(
    [...rawKeys].map((key) => previewKeyByRawKey.get(key) ?? key),
  );
}

function hoverContext(element: AxElement) {
  const source = element.source;
  if (!source) {
    return { title: axElementHoverLabel(element), location: null };
  }
  const location = source.file
    ? `${source.file}${source.line ? `:${source.line}` : ""}`
    : null;
  return {
    title: axElementHoverLabel(element),
    location,
  };
}

export type AxDomOverlayMode = "inspect-passive" | "inspect-select";

export function shouldShowAxPhoneTooltip(
  mode: AxDomOverlayMode,
  origin: AxHighlightOrigin,
): boolean {
  return origin === "phone" && mode === "inspect-select";
}

export function AxDomOverlay({
  onSelectTarget,
  mode = "inspect-passive",
  showAllOutlines = false,
}: {
  onSelectTarget?: (key: string) => void;
  mode?: AxDomOverlayMode;
  showAllOutlines?: boolean;
}) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const { snapshot } = useAxSnapshotContext();
  const {
    highlightedKey,
    highlightedOrigin,
    selectedKey,
    setHighlightedKey,
    setSelectedKey,
  } = useAxSelectionContext();
  const inspecting = true;
  const interactive = mode === "inspect-select";
  const selectionBehaviorRef = useRef({
    setSelectedKey,
    onSelectTarget,
    setHighlightedKey,
  });
  selectionBehaviorRef.current = {
    setSelectedKey,
    onSelectTarget,
    setHighlightedKey,
  };
  const handleTargetSelect = useCallback((key: string) => {
    const current = selectionBehaviorRef.current;
    current.setHighlightedKey(null, "phone");
    current.setSelectedKey(key, "phone");
    current.onSelectTarget?.(key);
  }, []);
  const handlePhoneHighlight = useCallback((key: string | null) => {
    setHighlightedKey(key, "phone");
  }, [setHighlightedKey]);

  const screenWidth = snapshot?.screen.width ?? 0;
  const screenHeight = snapshot?.screen.height ?? 0;
  const overlayEntries = useMemo(
    () => snapshot && screenWidth > 0 && screenHeight > 0
      ? buildAxOverlayTargetEntries(snapshot.elements, snapshot.screen, {
          actionableOnly: inspecting,
        })
      : {
          visibleEntries: [],
          eligibleEntries: [],
          previewKeyByRawKey: new Map<string, string>(),
        },
    [inspecting, screenHeight, screenWidth, snapshot],
  );
  const eligibleEntries = overlayEntries.eligibleEntries;
  const eligibleByKey = useMemo(
    () => new Map(eligibleEntries.map((entry) => [entry.key, entry])),
    [eligibleEntries],
  );
  const eligibleKeys = useMemo(
    () => new Set(eligibleEntries.map((entry) => entry.key)),
    [eligibleEntries],
  );
  const previewHighlightedKey = highlightedKey
    ? overlayEntries.previewKeyByRawKey.get(highlightedKey) ?? null
    : null;
  const highlightedElement = previewHighlightedKey
    ? eligibleByKey.get(previewHighlightedKey)?.element ?? null
    : null;
  const highlightedFrame = highlightedElement
    ? clampAxFrameForScreen(highlightedElement.frame, { width: screenWidth, height: screenHeight })
    : null;
  const hover = highlightedElement &&
      shouldShowAxPhoneTooltip(mode, highlightedOrigin)
    ? hoverContext(highlightedElement)
    : null;
  const selectedKeys = useMemo(
    () => new Set(selectedKey ? [selectedKey] : []),
    [selectedKey],
  );
  const projectedSelectedKeys = useMemo(
    () => projectAxOverlayTargetKeys(
      selectedKeys,
      overlayEntries.previewKeyByRawKey,
    ),
    [overlayEntries.previewKeyByRawKey, selectedKeys],
  );
  const renderedEntries = useMemo(() => {
    return selectRenderedAxTargetEntries(eligibleEntries, {
      interactive,
      inspecting,
      showAllOutlines,
      highlightedKey: previewHighlightedKey,
      selectedKeys: projectedSelectedKeys,
    });
  }, [
    previewHighlightedKey,
    inspecting,
    interactive,
    projectedSelectedKeys,
    showAllOutlines,
    eligibleEntries,
  ]);
  const [overlayRect, setOverlayRect] = useState<OverlayViewportRect | null>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    let animationFrame: number | null = null;
    const measure = () => {
      animationFrame = null;
      const rect = overlay.getBoundingClientRect();
      const next = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
      setOverlayRect((current) =>
        current &&
        Math.abs(current.left - next.left) < 0.5 &&
        Math.abs(current.top - next.top) < 0.5 &&
        Math.abs(current.width - next.width) < 0.5 &&
        Math.abs(current.height - next.height) < 0.5
          ? current
          : next
      );
    };
    const scheduleMeasure = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(measure);
    };

    measure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(overlay);
    window.addEventListener("resize", scheduleMeasure);
    window.addEventListener("scroll", scheduleMeasure, true);
    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
      window.removeEventListener("scroll", scheduleMeasure, true);
    };
  }, []);

  const hoverPosition = useMemo<HoverPosition | null>(() => {
    if (
      !highlightedFrame ||
      !overlayRect ||
      screenWidth <= 0 ||
      screenHeight <= 0
    ) {
      return null;
    }
    const scaleX = overlayRect.width / screenWidth;
    const scaleY = overlayRect.height / screenHeight;
    const targetCenter =
      overlayRect.left +
      (highlightedFrame.x + highlightedFrame.width / 2) * scaleX;
    const targetTop = overlayRect.top + highlightedFrame.y * scaleY;
    const targetBottom =
      overlayRect.top +
      (highlightedFrame.y + highlightedFrame.height) * scaleY;
    const above = targetTop > 58;
    return {
      left: Math.max(124, Math.min(window.innerWidth - 124, targetCenter)),
      top: above ? targetTop - 8 : targetBottom + 8,
      above,
    };
  }, [
    highlightedFrame,
    overlayRect,
    screenHeight,
    screenWidth,
  ]);

  if (!snapshot || screenWidth <= 0 || screenHeight <= 0) return null;

  return (
    <>
      <div ref={overlayRef} className="absolute inset-0 z-10 overflow-hidden pointer-events-none">
        {renderedEntries.map(({ element, index, key }) => {
          return (
            <AxTarget
              key={key}
              element={element}
              index={index}
              screen={snapshot.screen}
              highlighted={key === previewHighlightedKey}
              selected={
                projectedSelectedKeys.has(key)
              }
              interactive={interactive && eligibleKeys.has(key)}
              outlined={interactive || (inspecting && showAllOutlines)}
              onHighlight={handlePhoneHighlight}
              onSelect={handleTargetSelect}
            />
          );
        })}
      </div>
      {hover && hoverPosition && createPortal(
        <div
          className="agentsims-accessibility-tooltip pointer-events-none fixed z-[90] max-w-[280px] rounded-md bg-[#171719] px-2 py-1.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.48),0_0_0_1px_rgba(255,255,255,0.12)]"
          style={{
            left: hoverPosition.left,
            top: hoverPosition.top,
            transform: hoverPosition.above ? "translate(-50%, -100%)" : "translateX(-50%)",
          }}
        >
          <div className="truncate text-[10px] font-semibold leading-tight text-white/92">
            {hover.title}
          </div>
          {hover.location && (
            <div className="mt-0.5 truncate font-mono text-[9px] leading-tight text-emerald-300/80">
              {hover.location}
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
