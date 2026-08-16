export function parseForegroundAppLogMessage(
	message: string,
): { bundleId: string; pid: number } | null {
	const match =
		/\[app<([^>]+)>:(\d+)\] Setting process visibility to: Foreground/.exec(
			message,
		);
	if (!match) return null;
	return { bundleId: match[1]!, pid: Number.parseInt(match[2]!, 10) };
}
