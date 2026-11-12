import { useCallback, useState } from "react";
import type { ContextPromptDetail } from "../../../core/tools/context/prompt";
import {
	readAnnotationDetail,
	writeAnnotationDetail,
} from "../../annotation/detail";

/** The prompt detail level, kept for this browser. */
export function useAnnotationDetail() {
	const [detail, setDetail] = useState<ContextPromptDetail>(() =>
		readAnnotationDetail(globalThis.localStorage),
	);
	const update = useCallback((next: ContextPromptDetail) => {
		setDetail(next);
		writeAnnotationDetail(globalThis.localStorage, next);
	}, []);
	return [detail, update] as const;
}
