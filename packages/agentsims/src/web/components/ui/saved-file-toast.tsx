import { Button } from "@agentsims/ui/components/button";
import { openFileCommand, type ExecResult } from "../../simulator/input/exec";
import { savedLocationLabel } from "../../media/saved-location";
import { CopyButton } from "./copy-button";
import { notify } from "./toast";

export type SavedFileCopy =
	| { kind: "text"; text: string }
	| { kind: "image"; copy: () => Promise<void> };

/**
 * One confirmation for every file that the host saves: recordings and
 * screenshots. It names the directory, never the long file name.
 */
export function notifySavedFile({
	title,
	path,
	exec,
	copy,
}: {
	title: string;
	path: string;
	exec: (command: string) => Promise<ExecResult>;
	copy: SavedFileCopy;
}) {
	const view = () => {
		void exec(openFileCommand(path)).then(
			(result) => {
				if (result.exitCode !== 0)
					notify("error", "The file did not open", {
						description: result.stderr.trim() || path,
					});
			},
			() => notify("error", "The file did not open"),
		);
	};
	notify("success", title, {
		description: savedLocationLabel(path),
		action: (
			<div className="flex shrink-0 gap-1.5">
				<Button
					variant="flat"
					size="xs"
					type="button"
					onClick={(event) => {
						event.stopPropagation();
						view();
					}}
				>
					View
				</Button>
				{copy.kind === "text" ? (
					<CopyButton text={copy.text} size="icon-xs" variant="toolbar" />
				) : (
					<CopyButton
						copy={copy.copy}
						label="Copy image"
						size="icon-xs"
						variant="toolbar"
					/>
				)}
			</div>
		),
		duration: 8000,
	});
}
