import { useEffect, useState } from "react";

const RESET_MS = 1500;

/**
 * Copies text to the clipboard. `copied` is true for a short time after a
 * copy. If the browser refuses clipboard access, nothing changes and the
 * text on the page stays selectable.
 */
export function useCopy() {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = window.setTimeout(() => setCopied(false), RESET_MS);
		return () => window.clearTimeout(timer);
	}, [copied]);

	async function copy(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			return;
		}
		setCopied(true);
	}

	return { copied, copy };
}
