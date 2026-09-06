import { useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { notify } from "../../components/ui/toast";
import { execOnHost, shellEscape } from "../../simulator/input/exec";

export function useScreenshotToast() {
	const reportError = useCallback((message: string) => {
		notify("error", "Screenshot failed", { description: message });
	}, []);
	const reportSaved = useCallback((path: string) => {
		notify("success", "Screenshot Saved", {
			description: "Show in Finder",
			onClick: () => void execOnHost(`open -R ${shellEscape(path)}`),
			action: (
				<ChevronRight
					aria-hidden="true"
					size={16}
					strokeWidth={2.25}
					className="shrink-0 text-white/80"
				/>
			),
		});
	}, []);
	const reportCopied = useCallback(() => {
		notify("success", "Screenshot copied to clipboard");
	}, []);
	return { reportError, reportSaved, reportCopied };
}
