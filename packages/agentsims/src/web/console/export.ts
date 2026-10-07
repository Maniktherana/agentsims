import type { LogRecord } from "../../core/tools/logs/contracts";
import { copyRecords } from "./state";

/** Save captured text through the runtime's file-save path, as screenshots do. */
export async function downloadLogs(
	records: readonly LogRecord[],
	name: string,
	basePath = "",
): Promise<string> {
	const response = await fetch(`${basePath.replace(/\/+$/, "")}/logs/export`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, text: copyRecords(records) }),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error("Could not save logs.");
	const receipt: unknown = await response.json();
	if (
		!receipt ||
		typeof receipt !== "object" ||
		!("path" in receipt) ||
		typeof receipt.path !== "string" ||
		!receipt.path
	)
		throw new Error("The runtime did not return a log file.");
	return receipt.path;
}
