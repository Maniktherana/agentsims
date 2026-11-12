import {
	isContextPromptDetail,
	type ContextPromptDetail,
} from "../../core/tools/context/prompt";

export const ANNOTATION_DETAIL_STORAGE_KEY = "agentsims.annotation.detail";

export function readAnnotationDetail(
	storage: Pick<Storage, "getItem"> | undefined,
): ContextPromptDetail {
	try {
		const value = storage?.getItem(ANNOTATION_DETAIL_STORAGE_KEY);
		return isContextPromptDetail(value) ? value : "standard";
	} catch {
		return "standard";
	}
}

export function writeAnnotationDetail(
	storage: Pick<Storage, "setItem"> | undefined,
	detail: ContextPromptDetail,
): void {
	try {
		storage?.setItem(ANNOTATION_DETAIL_STORAGE_KEY, detail);
	} catch {
		// Storage can be full or blocked. The choice still applies to this page.
	}
}
