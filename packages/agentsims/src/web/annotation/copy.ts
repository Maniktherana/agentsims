import type { ContextPromptDetail } from "../../core/tools/context/prompt";
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

export interface CopiedAnnotationNotes {
	/** The copied prompt and images. A later image-only copy uses this payload. */
	readonly payload: AnnotationSendPayload;
	/** Remove the copied notes. Call it when the user no longer needs them. */
	readonly clear: () => void;
}

/**
 * Starts the clipboard write before the first await, so call it directly from
 * the click. It does not clear notes; the caller decides when to clear them.
 */
export async function copyWorkspaceAnnotationNotes(
	controllers: readonly LiveAnnotationSummaryController[],
	current: () => readonly LiveAnnotationSummaryController[],
	detail: ContextPromptDetail = "standard",
	operations: {
		exportImages: (
			payload: AnnotationSendPayload,
		) => Promise<ReadonlyMap<string, string>>;
		copy: (payload: Promise<AnnotationSendPayload>) => Promise<void>;
	} = {
		exportImages: exportAnnotationImageFiles,
		copy: copyAnnotationPayload,
	},
): Promise<CopiedAnnotationNotes> {
	const comments = workspaceAnnotationComments(controllers);
	const prepared = (async () => {
		const payload = await prepareWorkspaceAnnotationExport(controllers, current);
		if (!payload)
			throw new Error(
				"Comments changed or image sync failed. Try Copy prompt again.",
			);
		const files = await operations.exportImages(payload);
		return exportAnnotationNotes(
			comments.map((entry) => entry.note),
			files,
			detail,
		);
	})();
	// The copy operation observes a failure; this only avoids a second report.
	prepared.catch(() => undefined);
	await operations.copy(prepared);
	const payload = await prepared;
	return {
		payload,
		clear: () => {
			for (const controller of current())
				controller.clearCopiedNotes(
					comments
						.filter((entry) => entry.device === controller.device)
						.map((entry) => entry.note),
				);
		},
	};
}
