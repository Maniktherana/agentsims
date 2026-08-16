export function parseDetachedOutput<T>(output: string): T {
	const lines = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		try {
			return JSON.parse(lines[index]!) as T;
		} catch (error) {
			if (index === 0) {
				throw new Error(
					`Detached server output did not contain JSON:\n${output}`,
					{
						cause: error,
					},
				);
			}
		}
	}
	throw new Error("Detached server produced no output");
}
