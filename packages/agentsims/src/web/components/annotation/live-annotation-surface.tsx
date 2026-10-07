import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@agentsims/ui/components/button";
import { Textarea } from "@agentsims/ui/components/textarea";
import {
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import type {
	AnnotationGeometry,
	AnnotationPoint,
} from "../../annotation/contracts";
import type { LiveAnnotationController } from "../../annotation/live-contracts";
import { ANNOTATION_NOTE_CHARACTER_LIMIT } from "../../annotation/live-contracts";
import {
	boundAnnotationFocusPoint,
	moveAnnotationFocusPoint,
} from "../../annotation/keyboard";
import { annotationEditorKeyAction } from "../../annotation/presentation";
import type { AxRect } from "../../../core/tools/observe/accessibility-model";

const styles = {
	outline:
		"pointer-events-none absolute rounded-sm border-2 border-primary shadow-[0_0_0_1px_rgba(0,0,0,0.35)]",
	pill: "pointer-events-auto fixed z-[95] rounded-[22px] bg-popover p-1.5 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,0.3),0_0_0_1px_var(--border)]",
	input:
		"min-h-6 max-h-28 resize-none rounded-none bg-transparent px-2 py-0 text-[13px] leading-6 shadow-none hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0",
	pin: "pointer-events-auto absolute flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground shadow-[0_0_0_2px_var(--background)] outline-none focus-visible:ring-2 focus-visible:ring-foreground",
	message: "px-2 pb-1 pt-1 text-xs leading-relaxed text-muted-foreground",
};

function percentRect(
	rect: AxRect,
	geometry: AnnotationGeometry,
): CSSProperties {
	return {
		left: `${((rect.x - geometry.viewport.x) / geometry.viewport.width) * 100}%`,
		top: `${((rect.y - geometry.viewport.y) / geometry.viewport.height) * 100}%`,
		width: `${(rect.width / geometry.viewport.width) * 100}%`,
		height: `${(rect.height / geometry.viewport.height) * 100}%`,
	};
}

function editorPosition(
	rect: AxRect | null,
	geometry: AnnotationGeometry,
): CSSProperties {
	const anchor = rect ?? geometry.viewport;
	const width = Math.min(320, window.innerWidth - 24);
	const below = anchor.y + anchor.height + 8;
	return {
		width,
		left: Math.max(
			12,
			Math.min(
				window.innerWidth - width - 12,
				anchor.x + anchor.width / 2 - width / 2,
			),
		),
		top: Math.max(
			12,
			Math.min(
				window.innerHeight - 52,
				below > window.innerHeight - 52 ? anchor.y - 48 : below,
			),
		),
	};
}

/** Screen targeting only. Root hosts the workspace summary above its dock. */
export function LiveAnnotationSurface({
	controller,
	geometry,
	onEditStart,
	onEscape,
}: {
	controller: LiveAnnotationController;
	geometry: AnnotationGeometry | null;
	onEditStart?: () => void;
	onEscape?: () => void;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const focusPointRef = useRef<AnnotationPoint | null>(null);
	const lastEditorRef = useRef<string | null>(null);
	const textareaId = useId();
	const editor = controller.editor;
	const tooLong =
		!!editor && editor.note.length > ANNOTATION_NOTE_CHARACTER_LIMIT;
	const editorRect = editor ? controller.noteViewportRect(editor) : null;
	const outline = controller.hoverTarget?.viewportRect ?? null;
	useLayoutEffect(() => {
		if (editor && editor.id !== lastEditorRef.current)
			textareaRef.current?.focus();
		lastEditorRef.current = editor?.id ?? null;
	}, [editor]);
	useEffect(() => {
		if (!controller.active && !editor) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.repeat || event.isComposing) return;
			if (
				event.defaultPrevented ||
				(event.target instanceof Element &&
					event.target.closest("[data-annotation-summary]"))
			)
				return;
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			if (onEscape) onEscape();
			else controller.escape();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [controller.active, controller.escape, editor, onEscape]);
	if (!geometry) return null;
	return (
		<>
			<div
				className="pointer-events-none absolute inset-0 z-20"
				data-agentsims-annotation={controller.device}
				onPointerDown={(event) => event.stopPropagation()}
				onWheel={(event) => event.stopPropagation()}
			>
				{controller.selecting ? (
					<div
						className="pointer-events-auto absolute inset-0 cursor-default outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
						aria-label="Select a screen target for a comment"
						aria-describedby={`${textareaId}-keys`}
						role="button"
						tabIndex={0}
						onBlur={() => controller.hover(null)}
						onPointerMove={(event) => {
							const point = { x: event.clientX, y: event.clientY };
							focusPointRef.current = boundAnnotationFocusPoint(
								point,
								geometry,
							);
							controller.hover(point);
						}}
						onPointerLeave={() => controller.hover(null)}
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
						onClick={(event) => {
							event.preventDefault();
							event.stopPropagation();
							controller.select({ x: event.clientX, y: event.clientY });
						}}
						onKeyDown={(event) => {
							if (event.key.startsWith("Arrow")) {
								event.preventDefault();
								event.stopPropagation();
								focusPointRef.current = moveAnnotationFocusPoint(
									focusPointRef.current,
									geometry,
									event.key,
									event.shiftKey,
								);
								controller.hover(focusPointRef.current);
							} else if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								event.stopPropagation();
								const point = boundAnnotationFocusPoint(
									focusPointRef.current,
									geometry,
								);
								if (point) controller.select(point);
							}
						}}
					/>
				) : controller.inputDisabled ? (
					<div
						className="pointer-events-auto absolute inset-0"
						aria-hidden="true"
						onPointerDown={(event) => {
							event.preventDefault();
							event.stopPropagation();
						}}
						onClick={(event) => event.stopPropagation()}
					/>
				) : null}
				<span id={`${textareaId}-keys`} className="sr-only">
					Use Arrow keys to move the target. Hold Shift for a larger step. Press
					Enter or Space to add a comment.
				</span>
				{outline ? (
					<div
						aria-hidden="true"
						className={styles.outline}
						style={percentRect(outline, geometry)}
					/>
				) : null}
				{controller.comments.map((note, index) => {
					const rect = controller.noteViewportRect(note);
					return rect ? (
						<button
							key={note.id}
							type="button"
							className={styles.pin}
							aria-label={`Edit comment ${index + 1}`}
							style={{
								left: `${((rect.x + rect.width - geometry.viewport.x) / geometry.viewport.width) * 100}%`,
								top: `${((rect.y + rect.height - geometry.viewport.y) / geometry.viewport.height) * 100}%`,
								transform: "translate(-50%, -50%)",
							}}
							onClick={(event) => {
								event.stopPropagation();
								onEditStart?.();
								controller.editNote(note.id);
							}}
						>
							{index + 1}
						</button>
					) : null;
				})}
			</div>
			{editor && typeof document !== "undefined"
				? createPortal(
						<div
							className={styles.pill}
							data-annotation-editor={controller.device}
							style={editorPosition(editorRect, geometry)}
							onPointerDown={(event) => event.stopPropagation()}
							onWheel={(event) => event.stopPropagation()}
						>
							<div className="flex items-center gap-1">
								<label className="sr-only" htmlFor={textareaId}>
									Comment for selected target
								</label>
								<Textarea
									id={textareaId}
									ref={textareaRef}
									rows={1}
									value={editor.note}
									placeholder="What should change?"
									className={styles.input}
									aria-invalid={tooLong}
									aria-describedby={`${textareaId}-hint`}
									onChange={(event) => controller.setNote(event.target.value)}
									onKeyDown={(event) => {
										if (
											annotationEditorKeyAction(
												event.key,
												event.shiftKey,
												event.nativeEvent.isComposing,
											) === "save"
										) {
											event.preventDefault();
											event.stopPropagation();
											controller.saveDraft();
										}
									}}
								/>
								<Button
									variant="contrast"
									size="icon-sm"
									className="shrink-0 rounded-full"
									aria-label="Save comment"
									disabled={!editor.note.trim() || tooLong}
									onClick={controller.saveDraft}
								>
									<HugeiconsIcon
										icon={ArrowUp02Icon}
										className="size-4"
										strokeWidth={1.5}
									/>
								</Button>
							</div>
							<p
								id={`${textareaId}-hint`}
								className={tooLong ? styles.message : "sr-only"}
							>
								{tooLong
									? "Shorten this comment to 4,096 characters before saving. Your text is retained."
									: "Enter saves. Shift plus Enter adds a line. Escape keeps the draft."}
							</p>
							{controller.status && !tooLong ? (
								<p role="status" className={styles.message}>
									{controller.status}
								</p>
							) : null}
						</div>,
						document.body,
					)
				: null}
		</>
	);
}
