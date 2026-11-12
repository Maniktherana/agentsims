import { useCallback } from "react";
import { notify } from "../../components/ui/toast";

export function useScreenshotToast() {
	const reportError = useCallback((message: string) => {
		notify("error", "Screenshot failed", { description: message });
	}, []);
	const reportCopied = useCallback(() => {
		notify("success", "Screenshot copied to clipboard");
	}, []);
	return { reportError, reportCopied };
}
