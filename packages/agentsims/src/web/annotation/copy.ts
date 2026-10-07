import { copyAnnotationPayload, exportAnnotationImageFiles } from "./client";
import { exportAnnotationNotes } from "./evidence";
import type {
	AnnotationSendPayload,
	LiveAnnotationSummaryController,
} from "./live-contracts";
import {
	prepareWorkspaceAnnotationExport,
	workspaceAnnotationComments,
} from "./presentation";

export async function copyWorkspaceAnnotationNotes(
	controllers: readonly LiveAnnotationSummaryController[],
	current: () => readonly LiveAnnotationSummaryController[],
	operations = {
		exportImages: exportAnnotationImageFiles,
		copy: copyAnnotationPayload,
	},
): Promise<void> {
	const comments = workspaceAnnotationComments(controllers);
	const payload = await prepareWorkspaceAnnotationExport(controllers, current);
	if (!payload)
		throw new Error(
			"Comments changed or image sync failed. Try Copy prompt again.",
		);
	const files = await operations.exportImages(payload);
	const copied: AnnotationSendPayload = exportAnnotationNotes(
		comments.map((entry) => entry.note),
		files,
	);
	await operations.copy(copied);
	for (const controller of current())
		controller.clearCopiedNotes(
			comments
				.filter((entry) => entry.device === controller.device)
				.map((entry) => entry.note),
		);
}
