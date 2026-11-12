import type { ContextItem } from "./contracts";
import { formatContextPrompt, type ContextPromptDetail } from "./prompt";

/** Export takes an explicit reviewed selection. It never reads the live device. */
export function exportContext(
	items: readonly ContextItem[],
	detail: ContextPromptDetail = "standard",
) {
	const images: {
		id: string;
		mimeType: string;
		width: number;
		height: number;
		base64: string;
	}[] = [];
	for (const item of items)
		if (item.kind === "annotation") images.push({ id: item.id, ...item.image });
	const prompt = formatContextPrompt(
		items.map((item) => ({ note: item.note, evidence: item })),
		detail,
	);
	return { prompt, images };
}

export function summarizeContext(item: ContextItem) {
	if (item.kind === "logs") return item;
	const { base64: _, ...image } = item.image;
	return { ...item, image };
}
