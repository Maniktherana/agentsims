import { useNotebookLayout } from "fumadocs-ui/layouts/notebook";
import { SiteHeader } from "../site-header";

const iconButton =
	"inline-flex size-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground";

/**
 * Fills the docs layout header slot with the site header. The header spans
 * every grid column. Inline-size containment keeps its content width out of
 * the column sizes.
 */
export function DocsHeader() {
	const { slots } = useNotebookLayout();
	const SidebarTrigger = slots.sidebar?.trigger;
	return (
		<SiteHeader
			section="docs"
			className="sticky top-0 z-30 bg-background [contain:inline-size]"
			style={{ gridArea: "header", gridColumn: "1 / -1" }}
			actions={
				<>
					{SidebarTrigger && (
						<SidebarTrigger
							className={`${iconButton} md:hidden`}
							aria-label="Open docs navigation"
						>
							<svg
								aria-hidden="true"
								viewBox="0 0 24 24"
								className="size-4.5"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.5"
								strokeLinecap="round"
							>
								<path d="M4 7h16M4 12h16M4 17h16" />
							</svg>
						</SidebarTrigger>
					)}
				</>
			}
		/>
	);
}
