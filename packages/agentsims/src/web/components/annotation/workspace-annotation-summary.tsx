import {
	Cancel01Icon,
	Delete02Icon,
	Message01Icon,
	PencilEdit02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@agentsims/ui/components/button";
import { TextMorph } from "torph/react";
import { useEffect, useId, useRef, useState } from "react";
import type {
	AnnotationSendPayload,
	AnnotationSendResult,
	LiveAnnotationSummaryController,
} from "../../annotation/live-contracts";
import { copyWorkspaceAnnotationNotes } from "../../annotation/copy";
import {
	prepareWorkspaceAnnotationSend,
	workspaceAnnotationComments,
	annotationCapturedPreview,
	annotationSendNotification,
} from "../../annotation/presentation";
import { notify } from "../ui/toast";

export interface WorkspaceAnnotationSummaryProps {
	controllers: readonly LiveAnnotationSummaryController[];
	onEditDevice: (deviceId: string) => void;
	onCopied?: () => void;
	send?: (payload: AnnotationSendPayload) => Promise<AnnotationSendResult>;
}

const styles = {
	chip: "flex items-center gap-1 rounded-full bg-popover p-1.5 text-popover-foreground shadow-[0_8px_24px_rgba(0,0,0,0.3),0_0_0_1px_var(--border)]",
	list: "absolute bottom-full left-1/2 mb-2 w-80 max-w-[calc(100vw-24px)] -translate-x-1/2 rounded-xl bg-popover p-2 text-popover-foreground shadow-[0_12px_32px_rgba(0,0,0,0.35),0_0_0_1px_var(--border)]",
};

export function WorkspaceAnnotationSummary({
	controllers,
	onEditDevice,
	onCopied,
	send,
}: WorkspaceAnnotationSummaryProps) {
	const [open, setOpen] = useState(false);
	const [copying, setCopying] = useState(false);
	const [sending, setSending] = useState(false);
	const copyBusy = useRef(false);
	const sendBusy = useRef(false);
	const controllersRef = useRef(controllers);
	controllersRef.current = controllers;
	const countRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const listId = useId();
	const comments = workspaceAnnotationComments(controllers);
	const selected = controllers.filter((controller) =>
		controller.comments.some((note) => note.note.trim()),
	);
	const canSend = !!send && selected.every((controller) => controller.canSend);
	useEffect(() => {
		if (!comments.length) setOpen(false);
	}, [comments.length]);
	useEffect(() => {
		if (open) listRef.current?.focus();
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape" && !event.defaultPrevented) {
				event.preventDefault();
				setOpen(false);
				countRef.current?.focus();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open]);
	if (!comments.length) return null;
	const copy = async () => {
		if (copyBusy.current) return;
		copyBusy.current = true;
		setCopying(true);
		try {
			await copyWorkspaceAnnotationNotes(
				controllers,
				() => controllersRef.current,
			);
			setOpen(false);
			onCopied?.();
			notify("success", "Prompt copied");
		} catch (error) {
			notify("error", "Copy failed", {
				description:
					error instanceof Error
						? error.message
						: "Check clipboard access, then select Copy prompt again. Your notes are retained.",
			});
		} finally {
			copyBusy.current = false;
			setCopying(false);
		}
	};
	const sendComments = async () => {
		if (!send || !canSend || sendBusy.current) return;
		sendBusy.current = true;
		setSending(true);
		let dispatched = false;
		try {
			const payload = await prepareWorkspaceAnnotationSend(
				controllers,
				() => controllersRef.current,
			);
			if (!payload) {
				notify("error", "Context sync is incomplete", {
					description: "Use Copy prompt. Your notes are retained.",
				});
				return;
			}
			dispatched = true;
			const result = await send(payload);
			const feedback = annotationSendNotification(result);
			notify(feedback.kind, feedback.title, {
				description: feedback.description,
			});
		} catch {
			if (dispatched) {
				const feedback = annotationSendNotification({ status: "unknown" });
				notify(feedback.kind, feedback.title, {
					description: feedback.description,
				});
			} else
				notify("error", "Context sync failed", {
					description: "Use Copy prompt. Your notes are retained.",
				});
		} finally {
			sendBusy.current = false;
			setSending(false);
		}
	};
	return (
		<div
			className="pointer-events-auto relative"
			data-annotation-summary
			onPointerDown={(event) => event.stopPropagation()}
			onWheel={(event) => event.stopPropagation()}
		>
			{open ? (
				<div
					ref={listRef}
					id={listId}
					role="region"
					aria-label="Annotation comments"
					tabIndex={-1}
					className={styles.list}
				>
					<div className="mb-1 flex items-center justify-between gap-2">
						<span className="text-[13px] font-medium">Comments</span>
						<Button
							variant="quiet"
							size="icon-sm"
							aria-label="Close comments"
							onClick={() => {
								setOpen(false);
								countRef.current?.focus();
							}}
						>
							<HugeiconsIcon
								icon={Cancel01Icon}
								className="size-4"
								strokeWidth={1.5}
							/>
						</Button>
					</div>
					<div className="max-h-[min(420px,60vh)] overflow-auto overscroll-contain">
						{comments.map(({ device, note }, index) => {
							const preview = annotationCapturedPreview(note);
							const target = preview.target;
							return (
								<div
									key={`${device}:${note.id}`}
									className="flex items-start gap-2 py-2"
								>
									<div
										className="relative shrink-0"
										style={{
											width: preview.width,
											height: preview.height,
											aspectRatio:
												note.evidence.image.width / note.evidence.image.height,
										}}
									>
										<img
											className="block h-full w-full rounded-md"
											src={`data:${note.evidence.image.mimeType};base64,${note.evidence.image.base64}`}
											alt={`Captured screen for comment ${index + 1}`}
										/>
										{target ? (
											<span
												aria-hidden="true"
												className="pointer-events-none absolute border border-primary"
												style={{
													left: `${(target.x / preview.width) * 100}%`,
													top: `${(target.y / preview.height) * 100}%`,
													width: `${(target.width / preview.width) * 100}%`,
													height: `${(target.height / preview.height) * 100}%`,
												}}
											/>
										) : null}
									</div>
									<div
										className="min-w-0 flex-1 overflow-hidden"
										style={{ maxHeight: preview.height }}
									>
										<p className="line-clamp-5 text-[13px] leading-[19px] [overflow-wrap:anywhere]">
											{index + 1}. {note.note}
										</p>
									</div>
									<div className="flex shrink-0 flex-col gap-1">
										<Button
											variant="danger-icon"
											size="icon-sm"
											aria-label={`Remove comment ${index + 1}`}
											onClick={() =>
												controllers
													.find((controller) => controller.device === device)
													?.removeNote(note.id)
											}
										>
											<HugeiconsIcon
												icon={Delete02Icon}
												className="size-4"
												strokeWidth={1.5}
											/>
										</Button>
										<Button
											variant="quiet"
											size="icon-sm"
											aria-label={`Edit comment ${index + 1}`}
											onClick={() => {
												setOpen(false);
												onEditDevice(device);
												controllers
													.find((controller) => controller.device === device)
													?.editNote(note.id);
											}}
										>
											<HugeiconsIcon
												icon={PencilEdit02Icon}
												className="size-4"
												strokeWidth={1.5}
											/>
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			) : null}
			<div className={styles.chip}>
				<Button
					ref={countRef}
					variant="quiet"
					size="sm"
					className="rounded-full"
					aria-expanded={open}
					aria-controls={listId}
					onClick={() => setOpen(!open)}
				>
					<HugeiconsIcon
						icon={Message01Icon}
						className="size-4 text-primary"
						strokeWidth={1.5}
					/>
					<TextMorph>{`${comments.length} ${comments.length === 1 ? "comment" : "comments"}`}</TextMorph>
				</Button>
				<Button
					variant="quiet"
					size="sm"
					className="rounded-full"
					disabled={copying}
					onClick={() => void copy()}
				>
					Copy prompt
				</Button>
				{canSend ? (
					<Button
						variant="raised"
						size="sm"
						className="rounded-full"
						disabled={
							sending || selected.some((controller) => controller.sending)
						}
						onClick={() => void sendComments()}
					>
						<TextMorph>{sending ? "Sending…" : "Send to chat"}</TextMorph>
					</Button>
				) : null}
			</div>
		</div>
	);
}
