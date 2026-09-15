/** Left-aligned columns, two spaces apart, no padding on the last column. */
export function formatTable(
	header: readonly string[],
	rows: readonly (readonly string[])[],
	empty = "None.",
): string {
	if (rows.length === 0) return empty;
	const widths = header.map((_, column) =>
		Math.max(...[header, ...rows].map((cells) => (cells[column] ?? "").length)),
	);
	return [header, ...rows]
		.map((cells) =>
			cells
				.map((cell, column) =>
					column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? 0),
				)
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
}

/** `label   value` pairs for single-record output. */
export function formatFields(
	pairs: readonly (readonly [string, string])[],
): string {
	const width = Math.max(...pairs.map(([label]) => label.length));
	return pairs
		.map(([label, value]) => `${label.padEnd(width)}  ${value}`.trimEnd())
		.join("\n");
}
