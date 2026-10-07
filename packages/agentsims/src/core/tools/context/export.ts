import type { ContextItem } from "./contracts";

function timestamp(value: number): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** Export takes an explicit reviewed selection. It never reads the live device. */
export function exportContext(items: readonly ContextItem[]) {
	const images: {
		id: string;
		mimeType: string;
		width: number;
		height: number;
		base64: string;
	}[] = [];
	const sections = items.map((item, index) => {
		const lines = [
			`${index + 1}. ${item.note || "Selected evidence"}`,
			`Device: ${item.device} (${item.platform})`,
			`Captured: ${timestamp(item.capturedAt)}`,
		];
		if (item.kind === "annotation") {
			if (item.target.kind === "element") {
				lines.push(
					`App: ${item.target.app}`,
					`Target: ${item.target.element.label || item.target.element.id} (${item.target.element.role})`,
				);
			} else lines.push("Target: selected screen region");
			lines.push(
				`Screenshot: attachment ${images.length + 1}`,
				`Image region: ${JSON.stringify(item.target.rect)}`,
			);
			images.push({ id: item.id, ...item.image });
			if (item.source)
				lines.push(
					`Source: ${item.source.file}:${item.source.line}`,
					item.source.lines
						.map(
							(line, offset) => `${item.source!.startLine + offset}: ${line}`,
						)
						.join("\n"),
				);
		}
		if (item.logs.length)
			lines.push(
				"Logs:",
				...item.logs.map(
					(record) =>
						`${record.sourceTime?.text ?? timestamp(record.receivedAt)} [${record.level}] ${record.tag ? `${record.tag}: ` : ""}${record.message}${record.stack ? `\n${record.stack}` : ""}`,
				),
			);
		return lines.join("\n");
	});
	return { prompt: sections.join("\n\n"), images };
}

export function summarizeContext(item: ContextItem) {
	if (item.kind === "logs") return item;
	const { base64: _, ...image } = item.image;
	return { ...item, image };
}
