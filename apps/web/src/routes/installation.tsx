import { createFileRoute, Link } from "@tanstack/react-router";
import { CommandBlock } from "../components/installation/command-block";
import { ps, sh, type Snippet } from "../code/tags";
import {
	brewSnippet,
	curlSnippet,
	powershellSnippet,
} from "../components/installation/commands";
import { platformRows } from "../components/installation/requirements";
import {
	Code,
	DataTable,
	GuidePage,
	Section,
	Text,
	textLink,
} from "../components/page";
import { TabStage } from "../components/tab-stage";

export const Route = createFileRoute("/installation")({
	head: () => ({ meta: [{ title: "Install · Agentsims" }] }),
	component: InstallPage,
});

/** The visitor's platform, from the head script, selects the first tab. */
const platformPreselect = {
	attribute: "install-platform",
	map: { macOS: "macos", Linux: "linux", Windows: "windows" },
	fallback: "linux",
};

function Option({ label, snippet }: { label: string; snippet: Snippet }) {
	return (
		<div className="flex flex-col gap-2">
			<p className="t-label m-0 uppercase">{label}</p>
			<CommandBlock snippet={snippet} label={`Copy: ${label}`} />
		</div>
	);
}

/** One tab of a tab stage that holds one command. */
function commandTab(value: string, label: string, snippet: Snippet, copy: string) {
	return {
		value,
		label,
		content: () => <CommandBlock snippet={snippet} label={copy} />,
	};
}

/** The section titles, by heading id, in page order. */
const contents = {
	"requirements": "Requirements",
	"install": "Install",
	"add-the-skill": "Add the skill",
	"check-that-it-works": "Check that it works",
	"update": "Update",
	"options": "Options",
	"data-location": "Data location",
} as const;

function InstallPage() {
	return (
		<GuidePage
			title="Install"
			lead="Install the CLI and the skill on your computer."
			contents={contents}
		>

			<Section id="requirements" title={contents["requirements"]}>
				<Text>
					For iOS, install Xcode and an iOS Simulator runtime. For Android,
					install the Android SDK with Platform-Tools and the emulator.
					Agentsims does not support physical iPhones.
				</Text>
				<DataTable head={["Computer", "Devices"]} rows={platformRows} />
			</Section>

			<Section id="install" title={contents["install"]}>
				<Text>
					The curl command also works on macOS. After curl installs
					Agentsims, open a new terminal. On Windows, use PowerShell. Windows on Arm runs the x64
					version through emulation.
				</Text>
				<TabStage
					label="Operating system"
					preselect={platformPreselect}
					tabs={[
						commandTab("macos", "macOS", brewSnippet, "Copy install command"),
						commandTab("linux", "Linux", curlSnippet, "Copy install command"),
						commandTab("windows", "Windows", powershellSnippet, "Copy install command"),
					]}
				/>
			</Section>

			<Section id="add-the-skill" title={contents["add-the-skill"]}>
				<Text>
					The{" "}
					<Link to="/skill" className={textLink}>
						skill
					</Link>{" "}
					teaches Claude Code, Codex, Cursor, and other agents to use
					Agentsims. The curl and PowerShell installers add it when Node.js is
					installed. After Homebrew, run the command yourself. Both commands
					need Node.js 20 or newer.
				</Text>
				<TabStage
					label="Install method"
					tabs={[
						commandTab("cli", "Agentsims CLI", sh`agentsims skill`, "Copy skill command"),
						commandTab(
							"npx",
							"npx",
							sh`npx skills add Maniktherana/agentsims --skill agentsims`,
							"Copy skill command",
						),
					]}
				/>
			</Section>

			<Section id="check-that-it-works" title={contents["check-that-it-works"]}>
				<Text>
					If <Code>doctor</Code> finds a problem, it tells you how to correct
					it.
				</Text>
				<CommandBlock snippet={sh`agentsims doctor`} label="Copy doctor command" />
			</Section>

			<Section id="update" title={contents["update"]}>
				<TabStage
					label="Installation method"
					tabs={[
						commandTab("homebrew", "Homebrew", sh`brew upgrade agentsims`, "Copy update command"),
						commandTab("curl", "curl", curlSnippet, "Copy update command"),
						commandTab("windows", "Windows", powershellSnippet, "Copy update command"),
					]}
				/>
			</Section>

			<Section id="options" title={contents["options"]}>
				<Text>
					The installers add the skill and add Agentsims to your{" "}
					<Code>PATH</Code>. These options skip each change. Without the{" "}
					<Code>PATH</Code> change, run <Code>~/.agentsims/bin/agentsims</Code>{" "}
					on macOS or Linux. On Windows, run{" "}
					<Code>%LOCALAPPDATA%\Agentsims\bin\agentsims.cmd</Code>.
				</Text>
				<TabStage
					label="Operating system"
					tabs={[
						{
							value: "unix",
							label: "macOS or Linux",
							content: () => (
								<div className="flex flex-col gap-4">
									<Option
										label="Install without the skill"
										snippet={sh`curl -fsSL https://agentsims.dev/install | bash -s -- --no-skill`}
									/>
									<Option
										label="Install without a change to PATH"
										snippet={sh`curl -fsSL https://agentsims.dev/install | bash -s -- --no-modify-path`}
									/>
								</div>
							),
						},
						{
							value: "windows",
							label: "Windows",
							content: () => (
								<div className="flex flex-col gap-4">
									<Option
										label="Install without the skill"
										snippet={ps`$env:AGENTSIMS_NO_SKILL = "1"; irm https://agentsims.dev/install.ps1 | iex`}
									/>
									<Option
										label="Install without a change to PATH"
										snippet={ps`$env:AGENTSIMS_NO_MODIFY_PATH = "1"; irm https://agentsims.dev/install.ps1 | iex`}
									/>
								</div>
							),
						},
					]}
				/>
			</Section>

			<Section id="data-location" title={contents["data-location"]}>
				<Text>
					Agentsims keeps its logs, screenshots, recordings, and traces in one
					directory.
				</Text>
				<DataTable
					head={["Item", "Value"]}
					mono={[1]}
					rows={[
						["Default directory", "~/.agentsims"],
						["Traces", "~/.agentsims/traces/<trace-id>/"],
						["Variable for another directory", "AGENTSIMS_HOME_DIR"],
					]}
				/>
			</Section>
		</GuidePage>
	);
}
