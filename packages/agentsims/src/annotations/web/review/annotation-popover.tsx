import {
  CheckCircle2,
  Clipboard,
  LoaderCircle,
  RotateCcw,
  Send,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ReviewIconButton } from "./review-icon-button";
import type {
  ReviewAnnotation,
  ReviewEditorDraft,
} from "./review-types";
import {
  ReviewTargetDisclosure,
  ReviewTargetIdentity,
} from "./target-source-context";

interface AnnotationPopoverFrameProps {
  label: string;
  exiting?: boolean;
  children: ReactNode;
}

function AnnotationPopoverFrame({
  label,
  exiting = false,
  children,
}: AnnotationPopoverFrameProps) {
  return (
    <aside
      aria-label={label}
      data-annotation-popover
      className={`w-full overflow-hidden rounded-xl border border-white/[0.1] bg-[#18181a] text-white shadow-[0_18px_48px_rgba(0,0,0,0.46)] ${
        exiting
          ? "agentsims-review-popover-exit pointer-events-none"
          : "agentsims-review-popover-enter"
      }`}
    >
      {children}
    </aside>
  );
}

export interface AnnotationComposerPopoverProps {
  draft: ReviewEditorDraft;
  saving?: boolean;
  compact?: boolean;
  exiting?: boolean;
  onNoteChange: (note: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function AnnotationComposerPopover({
  draft,
  saving = false,
  compact = false,
  exiting = false,
  onNoteChange,
  onSave,
  onCancel,
}: AnnotationComposerPopoverProps) {
  const canSave = draft.note.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !saving) onSave();
  };
  const saveFromKeyboard = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
    event.preventDefault();
    if (canSave && !saving) onSave();
  };
  return (
    <AnnotationPopoverFrame label="Write annotation" exiting={exiting}>
      <form onSubmit={submit}>
        <ReviewTargetDisclosure target={draft.target} compact={compact} />

        <div className="p-3">
          <textarea
            autoFocus
            rows={2}
            value={draft.note}
            onChange={(event) => onNoteChange(event.currentTarget.value)}
            onKeyDown={saveFromKeyboard}
            placeholder="What should change?"
            className="block min-h-16 w-full resize-none rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 py-2.5 text-[12px] leading-[18px] text-white/92 outline-none [transition-property:border-color,background-color,box-shadow] duration-[110ms] placeholder:text-white/28 hover:border-white/[0.16] focus:border-blue-400/65 focus:bg-white/[0.05] focus:shadow-[0_0_0_1px_rgba(96,165,250,0.18)] motion-reduce:transition-none"
          />

          <div className="mt-2 flex min-w-0 items-center justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="h-10 shrink-0 rounded-lg px-3 text-[11px] font-medium text-white/48 outline-none [transition-property:background-color,color,transform] duration-[110ms] hover:bg-white/[0.06] hover:text-white active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-blue-300/70 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave || saving}
              className="inline-flex h-10 min-w-16 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-[11px] font-semibold text-white outline-none [transition-property:background-color,transform,opacity] duration-[110ms] hover:bg-blue-500 active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-blue-300 focus-visible:ring-offset-1 focus-visible:ring-offset-[#18181a] disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none"
            >
              {saving ? (
                <LoaderCircle
                  size={13}
                  strokeWidth={2.2}
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : null}
              {saving ? "Adding" : "Add"}
            </button>
          </div>
        </div>
      </form>
    </AnnotationPopoverFrame>
  );
}

export interface AnnotationDetailPopoverProps {
  annotation: ReviewAnnotation;
  compact?: boolean;
  onClose: () => void;
  onResolve: (annotationId: string) => void;
  onReopen: (annotationId: string) => void;
  onCopy: (annotationId: string) => void;
  onSendToAgent: (annotationId: string) => void;
  onDelete: (annotationId: string) => void;
}

export function AnnotationDetailPopover({
  annotation,
  compact = false,
  onClose,
  onResolve,
  onReopen,
  onCopy,
  onSendToAgent,
  onDelete,
}: AnnotationDetailPopoverProps) {
  const resolved = annotation.status === "resolved";
  const markerTone = annotation.severity === "blocking"
    ? "bg-red-500"
    : annotation.severity === "important"
      ? "bg-amber-500"
      : "bg-blue-500";

  return (
    <AnnotationPopoverFrame label={`Annotation ${annotation.marker}`}>
      <div
        className={`flex items-center gap-2 border-b border-white/[0.07] px-2.5 ${
          compact ? "h-9" : "min-h-12 py-2"
        }`}
      >
        <span
          className={`grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold tabular-nums text-white ${markerTone}`}
        >
          {annotation.marker}
        </span>
        <div className="min-w-0 flex-1">
          <ReviewTargetIdentity
            target={annotation.target}
            compact={compact}
          />
        </div>
        <span
          className={`shrink-0 text-[9px] ${
            resolved ? "text-emerald-400/75" : "text-white/35"
          }`}
        >
          {resolved ? "Resolved" : "Open"}
        </span>
        <ReviewIconButton
          label="Close annotation detail"
          tooltip="Close"
          size="compact"
          onClick={onClose}
        >
          <X size={14} strokeWidth={2} />
        </ReviewIconButton>
      </div>

      <div className={compact ? "p-1.5" : "p-2.5"}>
        <p
          className={`m-0 whitespace-pre-wrap text-[11px] leading-[18px] text-white/88 ${
            compact
              ? "overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
              : ""
          }`}
        >
          {annotation.note}
        </p>
        {annotation.screenshotUrl && !compact && (
          <img
            src={annotation.screenshotUrl}
            alt={`Screenshot for annotation ${annotation.marker}`}
            className="mt-2.5 block max-h-36 w-full rounded-md border border-white/[0.08] bg-black object-contain"
          />
        )}
        {annotation.target.boundsLabel && !compact && (
          <div className="mt-2.5 border-t border-white/[0.07] pt-2">
            <div className="mt-1 truncate font-mono text-[9px] text-white/32">
              {annotation.target.boundsLabel}
            </div>
          </div>
        )}
      </div>

      <div
        role="toolbar"
        aria-label="Annotation actions"
        className={`flex items-center gap-0.5 border-t border-white/[0.07] px-1.5 ${
          compact ? "h-9" : "h-11"
        }`}
      >
        {resolved ? (
          <ReviewIconButton
            label="Reopen annotation"
            tooltip="Reopen"
            size="compact"
            onClick={() => onReopen(annotation.id)}
          >
            <RotateCcw size={14} strokeWidth={2} />
          </ReviewIconButton>
        ) : (
          <ReviewIconButton
            label="Resolve annotation"
            tooltip="Resolve"
            size="compact"
            onClick={() => onResolve(annotation.id)}
          >
            <CheckCircle2 size={14} strokeWidth={2} />
          </ReviewIconButton>
        )}
        <ReviewIconButton
          label="Copy annotation"
          tooltip="Copy"
          size="compact"
          onClick={() => onCopy(annotation.id)}
        >
          <Clipboard size={14} strokeWidth={2} />
        </ReviewIconButton>
        <ReviewIconButton
          label="Send annotation to agent"
          tooltip="Send to agent"
          size="compact"
          onClick={() => onSendToAgent(annotation.id)}
        >
          <Send size={14} strokeWidth={2} />
        </ReviewIconButton>
        <span className="flex-1" />
        <ReviewIconButton
          label="Delete annotation"
          tooltip="Delete"
          size="compact"
          tone="danger"
          onClick={() => onDelete(annotation.id)}
        >
          <Trash2 size={14} strokeWidth={2} />
        </ReviewIconButton>
      </div>
    </AnnotationPopoverFrame>
  );
}
