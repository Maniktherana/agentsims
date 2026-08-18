import { useCallback, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { BadgeCheckIcon } from "../../components/icons/badge-check";
import { execOnHost, shellEscape } from "../../simulator/input/exec";

function ScreenshotToastCard({
	title,
	description,
	onClick,
	action,
}: {
	title: string;
	description?: string;
	onClick?: () => void;
	action?: ReactNode;
}) {
	const content = (
		<>
			<BadgeCheckIcon size={18} className="shrink-0 text-emerald-400" />
			<div className="min-w-0 flex-1 leading-tight">
				<div className="truncate text-[13px] font-semibold text-white">
					{title}
				</div>
				{description ? (
					<div className="mt-0.5 truncate text-[11px] text-white/60">
						{description}
					</div>
				) : null}
			</div>
			{action}
		</>
	);
	const className =
		"flex w-[min(400px,calc(100vw-32px))] items-center gap-3 rounded-xl border border-white/12 bg-panel px-3 py-2.5 text-left shadow-[0_8px_24px_rgba(0,0,0,0.45)]";
	return onClick ? (
		<button
			type="button"
			onClick={onClick}
			className={`${className} cursor-pointer [transition:background-color_120ms_ease] hover:bg-[#2a2a2c]`}
		>
			{content}
		</button>
	) : (
		<div className={className}>{content}</div>
	);
}

const screenshotToastOptions = {
	duration: 3500,
	position: "top-center" as const,
};

export function useScreenshotToast() {
	const reportError = useCallback((message: string) => {
		toast.error("Screenshot failed", {
			description: message,
			position: "top-center",
		});
	}, []);

	const reportSaved = useCallback((path: string) => {
		const reveal = () => void execOnHost(`open -R ${shellEscape(path)}`);
		toast.custom(
			() => (
				<ScreenshotToastCard
					title="Screenshot Saved"
					description="Show in Finder"
					onClick={reveal}
					action={
						<ChevronRight
							aria-hidden="true"
							size={16}
							strokeWidth={2.25}
							className="shrink-0 text-white/80"
						/>
					}
				/>
			),
			screenshotToastOptions,
		);
	}, []);

	const reportCopied = useCallback(() => {
		toast.custom(
			() => <ScreenshotToastCard title="Screenshot copied to clipboard" />,
			screenshotToastOptions,
		);
	}, []);

	return { reportError, reportSaved, reportCopied };
}
