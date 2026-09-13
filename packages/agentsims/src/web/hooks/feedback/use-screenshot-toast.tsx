import { useCallback } from "react";
import { notify } from "../../components/ui/toast";

export function useScreenshotToast() {
	const reportError = useCallback((message: string) => {
		notify("error", "Screenshot failed", { description: message });
	}, []);
	const reportSaved = useCallback(() => {
		notify("success", "Screenshot download started", {
			description: "Check your browser downloads.",
		});
	}, []);
	const reportCopied = useCallback(() => {
		notify("success", "Screenshot copied to clipboard");
	}, []);
	return { reportError, reportSaved, reportCopied };
}
