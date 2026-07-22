import { Fragment } from "react";
import {
  useAnnotationContext,
  useAxSelectionContext,
  useAxSnapshotContext,
} from "./use-ax-snapshot";
import { axElementKey, clampAxFrameForScreen } from "./ax";
import { annotationEntryElements, annotationEntryLabel } from "./prompt";

export function AnnotationPins({
  screen: fallbackScreen,
}: {
  screen?: { width: number; height: number };
}) {
  const { annotations, markersVisible } = useAnnotationContext();
  const { snapshot } = useAxSnapshotContext();
  const { selectedKey, setSelectedKey } = useAxSelectionContext();
  const screen = snapshot?.screen ?? fallbackScreen;
  if (!markersVisible || !screen?.width || !screen.height || annotations.length === 0) return null;

  return (
    <div className="absolute inset-0 z-20 overflow-hidden pointer-events-none">
      {annotations.map((annotation, index) => {
        const elements = annotationEntryElements(annotation);
        const frames = annotation.bounds
          ? [annotation.bounds]
          : elements.map((element) => element.frame);
        const visibleFrames = frames
          .map((frame) => clampAxFrameForScreen(frame, screen))
          .filter((frame): frame is NonNullable<typeof frame> => !!frame);
        const firstElement = elements[0] ?? null;
        const key = firstElement ? axElementKey(firstElement) : null;
        const anchor = visibleFrames[0] ?? {
          x: screen.width * 0.04,
          y: screen.height * 0.04,
          width: 0,
          height: 0,
        };
        const active = key !== null && key === selectedKey;
        const severityClass = annotation.severity === "blocking"
          ? "bg-red-500 hover:bg-red-400"
          : annotation.severity === "important"
            ? "bg-amber-500 hover:bg-amber-400"
            : "bg-[#3b82f6] hover:bg-[#4f8df7]";
        const outline = annotation.severity === "blocking"
          ? "rgba(239,68,68,0.9)"
          : annotation.severity === "important"
            ? "rgba(245,158,11,0.9)"
            : "rgba(59,130,246,0.9)";
        return (
          <Fragment key={annotation.id}>
            {annotation.kind !== "screen" && visibleFrames.map((frame, frameIndex) => (
              <div
                key={`${annotation.id}:${frameIndex}`}
                className="absolute rounded-[3px] border pointer-events-none"
                style={{
                  left: `${(frame.x / screen.width) * 100}%`,
                  top: `${(frame.y / screen.height) * 100}%`,
                  width: `${(frame.width / screen.width) * 100}%`,
                  height: `${(frame.height / screen.height) * 100}%`,
                  borderColor: outline,
                  background: outline.replace("0.9", "0.08"),
                }}
              />
            ))}
            <button
              type="button"
              onClick={() => setSelectedKey(key)}
              title={annotation.note || annotationEntryLabel(annotation)}
              className={`absolute grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums text-white shadow-[0_4px_16px_rgba(0,0,0,0.38)] [transition-property:background,scale,opacity] duration-150 pointer-events-auto active:scale-[0.96] ${severityClass} ${active ? "ring-2 ring-white/85 ring-offset-1 ring-offset-black/45" : ""}`}
              style={{
                left: `${(anchor.x / screen.width) * 100}%`,
                top: `${(anchor.y / screen.height) * 100}%`,
                transform: "translate(-35%, -35%)",
              }}
            >
              {index + 1}
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
