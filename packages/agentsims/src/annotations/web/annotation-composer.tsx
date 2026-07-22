import { Check, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AxElement } from "../model";
import {
  useAnnotationContext,
  useAxSelectionContext,
  useAxSnapshotContext,
  type AnnotationSeverity,
} from "./use-ax-snapshot";
import { annotationTargetElements, axElementKey, axFrameString } from "./ax";
import {
  annotationElementLabel,
  annotationSourceLabel,
} from "./prompt";
import { SeverityControl } from "./severity-control";

function elementsForKeys(elements: AxElement[], keys: string[]) {
  const wanted = new Set(keys);
  return elements.filter((element) => wanted.has(axElementKey(element)));
}

export function AnnotationComposer({ active }: { active: boolean }) {
  const { snapshot } = useAxSnapshotContext();
  const { draft, composerOpen, closeComposer, clearMultiSelectedKeys } = useAxSelectionContext();
  const { addAnnotation, captureScreenshot } = useAnnotationContext();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState<AnnotationSeverity>("important");
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const elements = useMemo(
    () => snapshot ? annotationTargetElements(snapshot.elements, snapshot.screen) : [],
    [snapshot],
  );
  const selectedElements = draft ? elementsForKeys(elements, draft.elementKeys) : [];
  const selectedElement = selectedElements[0] ?? null;
  const source = annotationSourceLabel(selectedElement);

  useEffect(() => {
    if (!active && composerOpen) closeComposer();
  }, [active, closeComposer, composerOpen]);

  useEffect(() => {
    if (!composerOpen) return;
    setNote("");
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [composerOpen, draft]);

  if (!active || !composerOpen || !draft) return null;

  const title = draft.kind === "screen"
    ? "Current screen"
    : draft.kind === "area"
      ? `Area ${draft.bounds ? axFrameString(draft.bounds) : ""}`.trim()
      : draft.kind === "multi"
        ? `${selectedElements.length} selected elements`
        : annotationElementLabel(selectedElement);

  const save = async () => {
    if (!note.trim() || saving) return;
    setSaving(true);
    const screenshot = await captureScreenshot();
    addAnnotation({
      kind: draft.kind,
      elementKey: selectedElement ? axElementKey(selectedElement) : null,
      element: selectedElement,
      elements: selectedElements.length > 1 ? selectedElements : undefined,
      bounds: draft.bounds,
      note,
      severity,
      screenshot: screenshot ?? undefined,
    });
    if (draft.kind === "multi") clearMultiSelectedKeys();
    setNote("");
    setSeverity("important");
    setSaving(false);
    closeComposer();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      className="pointer-events-auto w-[min(440px,calc(100vw-32px))] rounded-lg bg-[#171719]/96 p-3 text-left shadow-[0_18px_55px_rgba(0,0,0,0.58),0_0_0_1px_rgba(255,255,255,0.12)] backdrop-blur-xl"
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-white/90">
            {title}
          </div>
          {source && (
            <div className="mt-0.5 truncate font-mono text-[9px] text-emerald-300/75">
              {source}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={closeComposer}
          className="grid size-6 shrink-0 place-items-center rounded-md text-white/45 hover:bg-white/[0.08] hover:text-white/80"
          aria-label="Close annotation"
          title="Close"
        >
          <X size={13} strokeWidth={2} />
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeComposer();
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            void save();
          }
        }}
        placeholder="What should change?"
        rows={2}
        className="mt-2 w-full resize-none rounded-md border-0 bg-white/[0.07] px-2 py-1.5 text-[11px] leading-snug text-white/90 outline-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] placeholder:text-white/35 focus:shadow-[inset_0_0_0_1px_rgba(96,165,250,0.72)]"
      />

      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <SeverityControl value={severity} onChange={setSeverity} />
        </div>
        <button
          type="submit"
          disabled={!note.trim() || saving}
          className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-md bg-[#3b82f6] px-2.5 text-[11px] font-semibold text-white [transition-property:background,scale,opacity] duration-150 hover:bg-[#4f8df7] active:scale-[0.96] disabled:pointer-events-none disabled:opacity-35"
        >
          {saving
            ? <LoaderCircle className="animate-spin" size={13} strokeWidth={2.25} />
            : <Check size={13} strokeWidth={2.25} />}
          {saving ? "Capturing" : "Add"}
        </button>
      </div>
    </form>
  );
}
