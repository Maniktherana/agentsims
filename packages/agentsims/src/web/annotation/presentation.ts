import type {
	LiveAnnotationNote,
	LiveAnnotationSummaryController,
	AnnotationSendPayload,
	AnnotationSendResult,
} from "./live-contracts";
import { exportAnnotationNotes, freezeAnnotationValue } from "./evidence";
import { annotationImageRectToViewport } from "./geometry";

export function annotationEditorKeyAction(
	key: string,
	shift: boolean,
	composing = false,
): "save" | "newline" | null {
	return key !== "Enter" || composing ? null : shift ? "newline" : "save";
}

export function annotationCapturedTargetRect(
	note: LiveAnnotationNote,
	width: number,
	height: number,
) {
	const image = note.evidence.image;
	return annotationImageRectToViewport(note.evidence.target.rect, {
		viewport: { x: 0, y: 0, width, height },
		image,
		axScreen: image,
	});
}

export function annotationCapturedPreview(
	note: LiveAnnotationNote,
	height = 96,
) {
	const width =
		(height * note.evidence.image.width) / note.evidence.image.height;
	return {
		width,
		height,
		target: annotationCapturedTargetRect(note, width, height),
	};
}

export function annotationSendNotification(result: AnnotationSendResult): {
	kind: "success" | "error";
	title: string;
	description: string;
} {
	if (result.status === "sent")
		return {
			kind: "success",
			title: "Sent to chat",
			description: "Your notes are retained.",
		};
	if (result.status === "unknown")
		return {
			kind: "error",
			title: "Send status is unknown",
			description:
				"Check the conversation before sending again. Your notes are retained.",
		};
	return {
		kind: "error",
		title: result.status === "unavailable" ? "Send unavailable" : "Send failed",
		description: result.message || "Use Copy prompt. Your notes are retained.",
	};
}

export function workspaceAnnotationComments(
	controllers: readonly LiveAnnotationSummaryController[],
): readonly { device: string; note: LiveAnnotationNote }[] {
	return controllers.flatMap((controller) =>
		controller.comments
			.filter((note) => note.note.trim())
			.map((note) => ({ device: controller.device, note })),
	);
}

export async function prepareWorkspaceAnnotationExport(
	controllers: readonly LiveAnnotationSummaryController[],
	current: () => readonly LiveAnnotationSummaryController[],
): Promise<AnnotationSendPayload | null> {
	const selected = controllers.filter((controller) =>
		controller.comments.some((note) => note.note.trim()),
	);
	const comments = workspaceAnnotationComments(selected);
	if (!comments.length) return null;
	const payloads = await Promise.all(
		selected.map((controller) => controller.prepareSendPayload()),
	);
	if (payloads.some((payload) => !payload?.retainedContext)) return null;
	const latest = workspaceAnnotationComments(current());
	if (
		latest.length !== comments.length ||
		comments.some(
			(entry, index) =>
				entry.device !== latest[index]?.device ||
				entry.note.id !== latest[index]?.note.id ||
				entry.note.note !== latest[index]?.note.note,
		)
	)
		return null;
	const contexts = payloads.map((payload) => payload!.retainedContext!);
	const workspace = contexts[0]!.workspace;
	const ids = contexts.flatMap((context) => context.ids);
	if (
		contexts.some((context) => context.workspace !== workspace) ||
		ids.length > 32 ||
		new Set(ids).size !== ids.length ||
		ids.length !== comments.length
	)
		return null;
	const local = exportAnnotationNotes(comments.map((entry) => entry.note));
	return freezeAnnotationValue({
		...local,
		retainedContext: { workspace, ids, prompt: local.prompt },
	});
}

export async function prepareWorkspaceAnnotationSend(
	controllers: readonly LiveAnnotationSummaryController[],
	current: () => readonly LiveAnnotationSummaryController[],
): Promise<AnnotationSendPayload | null> {
	if (
		controllers.some(
			(controller) =>
				controller.comments.some((note) => note.note.trim()) &&
				!controller.canSend,
		)
	)
		return null;
	return prepareWorkspaceAnnotationExport(controllers, current);
}
