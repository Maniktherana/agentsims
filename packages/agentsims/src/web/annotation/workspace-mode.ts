import type { LiveAnnotationSummaryController } from "./live-contracts";

export function endWorkspaceAnnotationMode(
	controllers: readonly LiveAnnotationSummaryController[],
): void {
	for (const controller of controllers) controller.endSelection();
}

/** All surfaces use this decision, independent of their window listener order. */
export function escapeWorkspaceAnnotationMode(
	controllers: readonly LiveAnnotationSummaryController[],
	focusedEditorDevice: string | null = null,
): "editor-closed" | "mode-ended" {
	const editor =
		controllers.find(
			(controller) =>
				controller.editorId && controller.device === focusedEditorDevice,
		) ?? controllers.find((controller) => controller.editorId);
	if (editor) {
		editor.closeEditor();
		return "editor-closed";
	}
	endWorkspaceAnnotationMode(controllers);
	return "mode-ended";
}
