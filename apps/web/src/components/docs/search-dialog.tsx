import { useMemo } from "react";
import { useDocsSearch } from "fumadocs-core/search/client";
import { staticClient } from "fumadocs-core/search/client/orama-static";
import {
	SearchDialog,
	SearchDialogClose,
	SearchDialogContent,
	SearchDialogHeader,
	SearchDialogIcon,
	SearchDialogInput,
	SearchDialogList,
	SearchDialogOverlay,
} from "fumadocs-ui/components/dialog/search";
import type { SharedProps } from "fumadocs-ui/contexts/search";
import { Kbd } from "@agentsims/ui/components/kbd";

/**
 * The docs search dialog. It uses the code block surface and the shared
 * keyboard key, and it searches the prerendered static index.
 */
export default function DocsSearchDialog(props: SharedProps) {
	const client = useMemo(() => staticClient({ from: "/api/search.json" }), []);
	const search = useDocsSearch({ client });
	return (
		<SearchDialog {...search} {...props}>
			<SearchDialogOverlay />
			<SearchDialogContent className="border-white/[0.08] bg-[var(--code-surface)] shadow-[0_24px_64px_oklch(0_0_0/0.6)]">
				<SearchDialogHeader>
					<SearchDialogIcon />
					<SearchDialogInput />
					<SearchDialogClose className="h-auto border-0 bg-transparent p-1 hover:bg-transparent">
						<Kbd>Esc</Kbd>
					</SearchDialogClose>
				</SearchDialogHeader>
				<SearchDialogList />
			</SearchDialogContent>
		</SearchDialog>
	);
}
