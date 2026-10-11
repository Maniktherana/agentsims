import { Button } from "@agentsims/ui/components/button";
import { cn } from "@agentsims/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { docsRoute } from "../../docs/links";

const sizes = {
	header: "h-9 px-4 text-[0.8125rem]",
	hero: "h-11 px-5",
} as const;

/** The primary call to action. The header and the hero use the same button. */
export function GetStartedButton({
	size,
	className,
}: {
	size: keyof typeof sizes;
	className?: string;
}) {
	return (
		<Button
			variant="contrast"
			size="unstyled"
			nativeButton={false}
			render={<Link {...docsRoute} />}
			className={cn("rounded-full", sizes[size], className)}
		>
			Get started
		</Button>
	);
}
