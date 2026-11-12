import { CopyIconSwap } from "../copy/copy-icon-swap";
import { useCopy } from "../copy/use-copy";
import { brewCommand, curlCommand, powershellCommand } from "./commands";

/** Instructions that a coding agent can follow to install Agentsims itself. */
const agentInstallPrompt = `Install Agentsims on this computer. Agentsims gives you a CLI to see and control iOS simulators and Android devices.

1. Install the CLI.
   - macOS: ${brewCommand}
   - Linux: ${curlCommand}
   - Windows (PowerShell): ${powershellCommand}
2. Run \`agentsims skill\` to install the Agentsims skill. This step needs Node.js 20 or newer.
3. Run \`agentsims start --detach\` to start the workspace.
4. Read the Agentsims skill before you use the CLI.

Documentation: https://agentsims.dev/installation`;

/**
 * A chip that copies the install instructions for a coding agent. It has the
 * box of a command chip. After a copy the icon is a check.
 */
export function PromptChip() {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			onClick={() => copy(agentInstallPrompt)}
			aria-label="Copy install prompt"
			className="chip"
			data-copied={copied || undefined}
		>
			<span className="chip-text">Copy install prompt</span>
			<span className="chip-icon">
				<CopyIconSwap copied={copied} />
			</span>
			<span className="sr-only" aria-live="polite">
				{copied ? "Copied" : ""}
			</span>
		</button>
	);
}
