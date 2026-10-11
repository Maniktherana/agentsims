import { IconSwap } from "@agentsims/ui/motion/icon-swap";

/**
 * The copy glyph, which swaps to a check badge after a copy. The landing page
 * and the docs code blocks share it.
 */
export function CopyIconSwap({ copied }: { copied: boolean }) {
	return (
		<span className="grid place-items-center" aria-hidden="true">
			<IconSwap state={copied ? "copied" : "copy"}>
				{!copied ? (
					<svg viewBox="0 0 20 20" className="size-3.5">
						<path
							d="m13 7h2c1.105 0 2 .895 2 2v6c0 1.105-.895 2-2 2H9c-1.105 0-2-.895-2-2v-2"
							fill="none"
							stroke="currentColor"
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth="2"
						/>
						<rect
							x="3"
							y="3"
							width="10"
							height="10"
							rx="2"
							stroke="currentColor"
							strokeWidth="2"
							fill="currentColor"
						/>
					</svg>
				) : (
					<svg viewBox="0 0 20 20" className="size-3.5">
						<path
							d="M17.999 10c0-1.097-.567-2.113-1.465-2.707.215-1.054-.103-2.174-.878-2.95-.775-.776-1.896-1.094-2.95-.878C12.113 2.568 11.097 2.001 10 2.001s-2.113.567-2.706 1.464c-1.053-.216-2.174.102-2.95.878s-1.093 1.896-.878 2.949C2.569 7.885 2.001 8.902 2.001 9.999s.567 2.113 1.465 2.707c-.215 1.054.103 2.174.878 2.95s1.898 1.092 2.95.878c.593.897 1.609 1.464 2.706 1.464s2.113-.568 2.706-1.465c1.059.214 2.176-.103 2.95-.878.776-.776 1.094-1.896.878-2.95.897-.593 1.465-1.609 1.465-2.707Zm-4.218-1.875-4 5a1 1 0 0 1-.726.374H9a1 1 0 0 1-.708-.292l-2-2a1 1 0 0 1 1.414-1.414l1.21 1.21 3.302-4.127a1 1 0 1 1 1.563 1.249Z"
							fill="currentColor"
						/>
					</svg>
				)}
			</IconSwap>
		</span>
	);
}
