import { createFileRoute, Link } from "@tanstack/react-router";
import { sh } from "../code/tags";
import { CommandBlock } from "../components/installation/command-block";
import {
	Code,
	DataTable,
	NamedList,
	GuidePage,
	Section,
	Steps,
	Text,
	textLink,
} from "../components/page";
import { TabStage } from "../components/tab-stage";

export const Route = createFileRoute("/skill")({
	head: () => ({ meta: [{ title: "Skill · Agentsims" }] }),
	component: SkillPage,
});

/** The section titles, by heading id, in page order. */
const contents = {
	"what-it-teaches": "What it teaches",
	"how-it-reads-a-result": "How it reads a result",
	"what-it-reads-when-needed": "What it reads when needed",
	"install": "Install",
	"ask-for-a-task": "Ask for a task",
	"give-screen-notes-to-the-agent": "Give screen notes to the agent",
	"start-agentsims-from-your-own-tool": "Start Agentsims from your own tool",
	"use-the-workspace-from-another-computer": "Use the workspace from another computer",
} as const;

/** The procedure of skills/agentsims/SKILL.md, one sentence for each step. */
const teachings = [
	{
		name: "Find the workspace.",
		text: (
			<>
				Runs <Code>agentsims status</Code>. Starts a workspace only if none is
				running.
			</>
		),
	},
	{
		name: "Pick one device.",
		text: (
			<>
				Copies an exact ID from <Code>agentsims devices list</Code> and passes
				it with <Code>-d</Code> on every device command.
			</>
		),
	},
	{
		name: "Write the goal.",
		text: "Writes the end state first, with the exact names, text, and numbers from your task.",
	},
	{
		name: "Observe.",
		text: "Reads the accessibility tree. Opens the screenshot only when the tree cannot answer, for example when the task is about how something looks.",
	},
	{
		name: "Pick a target.",
		text: "Prefers an element reference, then an exact label, then a point on the screen.",
	},
	{
		name: "Act once.",
		text: "Sends one action per command and never chains actions.",
	},
	{
		name: "Read the result.",
		text: (
			<>
				Reads the <Code>dispatch</Code> and <Code>verification</Code> lines and
				uses the returned tree as the next observation.
			</>
		),
	},
	{
		name: "Decide.",
		text: "Compares the result with the goal, then acts again or reports the result.",
	},
];

function SkillPage() {
	return (
		<GuidePage
			title="Skill"
			lead="The skill teaches your coding agent how to drive a device with the Agentsims CLI."
			contents={contents}
		>

			<Section id="what-it-teaches" title={contents["what-it-teaches"]}>
				<Text>
					Claude Code, Codex, Cursor, Gemini CLI, and other agents with Agent
					Skills can load the skill. The agent follows these eight steps with the{" "}
					<Link to="/cli" className={textLink}>
						CLI
					</Link>
					.
				</Text>
				<Steps
					items={teachings.map((step) => (
						<>
							<strong>{step.name}</strong> {step.text}
						</>
					))}
				/>
			</Section>

			<Section id="how-it-reads-a-result" title={contents["how-it-reads-a-result"]}>
				<Text>
					An accepted dispatch does not prove that the app changed. Only the
					tree, a readback, or a verification line proves it.
				</Text>
				<DataTable
					head={["You see", "It means"]}
					mono={[0]}
					rows={[
						["dispatch accepted", "The device took the input."],
						["dispatch none", "Nothing was sent. Refs and captures stay valid."],
						["dispatch unknown", "The input can have landed. Observe before any retry."],
						["verification matched", <>The <Code>checked:</Code> or <Code>value:</Code> change happened.</>],
						["verification mismatch", "The change did not happen."],
						["verification unavailable", "There is no evidence. The check stays unverified."],
						["verification not_applicable", "There is no judged check for this action."],
					]}
				/>
			</Section>

			<Section id="what-it-reads-when-needed" title={contents["what-it-reads-when-needed"]}>
				<Text>Five reference files cover special cases. The agent reads each one before its first command of that kind.</Text>
				<NamedList
					items={[
						{ name: "Forms.", text: "Before it types into a field, or before 3 or more label-addressed steps in one flow." },
						{ name: "Lists.", text: "Before it counts rows, collects a list, or answers a question about list contents." },
						{ name: "Pixels.", text: "Before a pixel point, a slider, a map, or work on a degraded tree." },
						{ name: "Motion.", text: "Before it watches video, animation, a timer, a splash screen, or a toast, or records the screen." },
						{
							name: "Device state.",
							text: "Before it installs or removes an app, changes permissions, uses the camera, reads logs, traces a run, or changes settings.",
						},
					]}
				/>
			</Section>

			<Section id="install" title={contents["install"]}>
				<Text>
					The curl and PowerShell installers add the skill. After Homebrew, or
					if the skill is missing, run one of these commands. Then start a new
					agent session. Add <Code>--agent</Code> for one agent only.
				</Text>
				<TabStage
					label="Install method"
					tabs={[
						{
							value: "cli",
							label: "Agentsims CLI",
							content: () => (
								<CommandBlock snippet={sh`agentsims skill`} label="Copy skill command" />
							),
						},
						{
							value: "npx",
							label: "npx",
							content: () => (
								<CommandBlock
									snippet={sh`npx skills add Maniktherana/agentsims --skill agentsims`}
									label="Copy skill command"
								/>
							),
						},
						{
							value: "one",
							label: "One agent",
							content: () => (
								<CommandBlock
									snippet={sh`agentsims skill --agent claude-code`}
									label="Copy skill command"
								/>
							),
						},
					]}
				/>
				<Text>
					<Code>agentsims skill</Code> runs the <Code>npx</Code> command. The{" "}
					<Code>npx</Code> command also works without the CLI. Both need
					Node.js 20 or newer.
				</Text>
			</Section>

			<Section id="ask-for-a-task" title={contents["ask-for-a-task"]}>
				<Text>
					Give the agent a task with a result on the device. It stops when the
					device shows the requested state. To review the run, open the{" "}
					<Link to="/" hash="workspace-logs-and-traces" className={textLink}>
						trace panel
					</Link>
					.
				</Text>
				<NamedList
					items={[
						{
							name: "Sign in.",
							text: "“Open the app on the Pixel emulator and sign in with the test account.”",
						},
						{
							name: "Dark mode.",
							text: "“Turn on dark mode on the iPhone simulator. Check that the settings screen is readable.”",
						},
						{
							name: "Permissions.",
							text: "“Deny the camera permission, then open the scanner screen. Tell me what the app shows.”",
						},
					]}
				/>
			</Section>

			<Section id="give-screen-notes-to-the-agent" title={contents["give-screen-notes-to-the-agent"]}>
				<Steps
					items={[
						<>
							Mark the problems on a phone screen with{" "}
							<Link to="/" hash="workspace-notes" className={textLink}>
								notes
							</Link>
							.
						</>,
						<>
							Select <strong>Copy prompt</strong>.
						</>,
						"Paste the notes into the agent.",
					]}
				/>
			</Section>

			<Section id="start-agentsims-from-your-own-tool" title={contents["start-agentsims-from-your-own-tool"]}>
				<Text>
					A tool stops only a server that it started. A workspace URL lets a
					tool use the workspace, but not stop it.
				</Text>
				<Steps
					items={[
						<>
							Run{" "}
							<Code>agentsims serve --port 0 --host 127.0.0.1 --json --managed</Code>
							.
						</>,
						"Read the URL of the server from the JSON record that it prints.",
						"Keep the standard input of the process open while you use the server.",
						"Close the standard input to stop the server and release its devices.",
					]}
				/>
			</Section>

			<Section id="use-the-workspace-from-another-computer" title={contents["use-the-workspace-from-another-computer"]}>
				<Text>
					Give access only to people that you trust. A person with access can
					control your devices and use the tools on your computer. For one
					public address, use a reverse proxy with WebSocket support. If the
					proxy ends HTTPS, forward the <Code>X-Forwarded-Proto</Code> header.
				</Text>
				<Steps
					items={[
						<>
							Forward the Agentsims port, which is <Code>3200</Code> by default.
						</>,
						"If you use Metro, also forward the port of the development server.",
					]}
				/>
			</Section>
		</GuidePage>
	);
}
