import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { sh, type Snippet } from "../code/tags";
import { CommandBlock } from "../components/installation/command-block";
import { WorkflowPicture } from "../components/pictures";
import {
	Code,
	DataTable,
	GuidePage,
	Section,
	Text,
} from "../components/page";

export const Route = createFileRoute("/cli")({
	head: () => ({ meta: [{ title: "CLI · Agentsims" }] }),
	component: CliPage,
});

/** The section titles, by heading id, in page order. */
const cliOutline = {
	"before-you-start": "Before you start",
	"device-ids": "Device IDs",
	"boot-or-shut-down-a-device": "Boot or shut down a device",
	"read-the-screen": "Read the screen",
	"tap-type-and-swipe": "Tap, type, and swipe",
	"read-the-result-of-an-action": "Read the result of an action",
	"install-and-open-apps": "Install and open apps",
	"use-a-webcam-as-the-device-camera": "Use a webcam as the camera",
	"change-app-permissions": "Change app permissions",
	"read-app-logs": "Read app logs",
	"record-the-screen": "Record the screen",
	"record-a-trace": "Record a trace",
	"wait-for-the-screen-and-run-steps": "Wait and run steps",
	"command-reference": "Command reference",
	"observe-options": "observe options",
} as const;

type Id = keyof typeof cliOutline;

/** One command group: a heading, one sentence, and the exact commands. */
function Group({
	id,
	text,
	snippet,
	children,
}: {
	id: Id;
	text: ReactNode;
	snippet: Snippet;
	/** A picture under the commands. */
	children?: ReactNode;
}) {
	return (
		<Section id={id} title={cliOutline[id]}>
			<Text>{text}</Text>
			<CommandBlock snippet={snippet} label="Copy commands" />
			{children}
		</Section>
	);
}

/** The command reference from docs/cli.md: the command, then its arguments. */
const reference: [string, string][] = [
	["start", "[--detach] [--host <address>] [--port <port>] [--codec <codec>]"],
	["stop", ""],
	["status", "[--json]"],
	["logs", "[--follow]"],
	["doctor", "[--platform android|ios]"],
	["skill", "[--global] [--agent <agents>] [--yes]"],
	["devices list", "[--all|--inactive|--json]"],
	["devices show", "<device>"],
	["devices boot", "<device>"],
	["devices shutdown", "<device>"],
	["observe", "--device <device> [-o <path>] [--all] [--frames] [--raw] [--json]"],
	["screenshot", "[path] --device <device> [--json]"],
	["find", "<text> --device <device>"],
	["wait", "--device <device>"],
	["run", "<file|-> --device <device>"],
	["tap", "<target> [--capture <id>] [--role <role>] [--index <n>] --device <device>"],
	["long-press", "<target> --device <device>"],
	["swipe", "<from> <to> [--capture <id>] [--duration <ms>] --device <device>"],
	["drag", "<from> <to> --device <device>"],
	["scroll", "<direction> --device <device>"],
	["type", "<text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>"],
	["fill", "<text> [--into <target>] [--submit] [--role <role>] [--index <n>] --device <device>"],
	["press", "<name> --device <device>"],
	["rotate", "<orientation> --device <device>"],
	["app list", "[--all] --device <device>"],
	["app install", "<path> --device <device>"],
	["app launch", "<app-id> --device <device>"],
	["app stop", "<app-id> --device <device>"],
	["app uninstall", "<app-id> --device <device>"],
	["camera", "list|use <webcam>|stop --device <device>"],
	["permissions", "list|grant|revoke|reset [<permission>] --device <device> --app <app-id>"],
	["app-logs", "--device <device> [--follow] [--level <level>] [--query <text>]"],
	["device-logs", "--device <android-device> [--limit <count>] [--level <level>]"],
	["record", "start|stop|status --device <device>"],
	["trace", "start|stop|status --device <device>"],
	["context", "list|add|note|save|remove|export"],
];

function CliPage() {
	return (
		<GuidePage
			title="CLI"
			lead="The commands that you and your agent run."
			contents={cliOutline}
		>

			<Group
				id="before-you-start"
				text={
					<>
						Start the workspace, then get the ID of each device for{" "}
						<Code>--device</Code>.
					</>
				}
				snippet={sh`agentsims start --detach
agentsims devices list`}
			/>

			<Section id="device-ids" title={cliOutline["device-ids"]}>
				<Text>
					If the workspace uses an address other than{" "}
					<Code>http://127.0.0.1:3200</Code>, add{" "}
					<Code>--url &lt;workspace-url&gt;</Code>.
				</Text>
				<DataTable
					head={["Device", "Example ID"]}
					mono={[1]}
					rows={[
						["Android emulator", "android:emulator-5554"],
						["Physical Android device", "android:R5CR20ABC"],
						["Android virtual device", "android-avd:Pixel_9"],
						["iOS simulator", "The simulator UDID"],
					]}
				/>
			</Section>

			<Group
				id="boot-or-shut-down-a-device"
				text={
					<>
						<Code>devices list</Code> shows the booted devices. Add{" "}
						<Code>--all</Code> to show all devices.
					</>
				}
				snippet={sh`agentsims devices boot android-avd:Pixel_9
agentsims devices shutdown android:emulator-5554`}
			/>

			<Group
				id="read-the-screen"
				text={
					<>
						<Code>observe</Code> reads the accessibility tree and saves a
						screenshot. Each element gets a reference, such as{" "}
						<Code>[ref=e5]</Code>.
					</>
				}
				snippet={sh`agentsims observe --device android:emulator-5554
agentsims find "Sign in" --device android:emulator-5554
agentsims screenshot /tmp/screen.png --device android:emulator-5554`}
			>
				<WorkflowPicture />
			</Group>

			<Group
				id="tap-type-and-swipe"
				text="Select a target by its reference, its exact label, a percent point, or a pixel point with a capture ID."
				snippet={sh`agentsims tap @e5 --device android:emulator-5554
agentsims tap "Sign in" --device android:emulator-5554
agentsims fill "Buy milk" --into "Task" --device android:emulator-5554
agentsims press home --device android:emulator-5554
agentsims rotate landscape_left --device android:emulator-5554
agentsims swipe 50%,80% 50%,20% --device android:emulator-5554
agentsims tap 603,1311 --capture c1 --device android:emulator-5554`}
			/>

			<Section
				id="read-the-result-of-an-action"
				title={cliOutline["read-the-result-of-an-action"]}
			>
				<Text>
					Each action prints two results. <Code>dispatch accepted</Code> does
					not prove that the app changed. If <Code>dispatch</Code> is{" "}
					<Code>unknown</Code>, do not send the action again. Run{" "}
					<Code>observe</Code> first.
				</Text>
				<DataTable
					head={["Result", "Meaning"]}
					mono={[0]}
					rows={[
						[
							"dispatch",
							<>
								The device received the input: <Code>accepted</Code>,{" "}
								<Code>none</Code>, or <Code>unknown</Code>.
							</>,
						],
						[
							"verification",
							<>
								The new state matches the request: <Code>matched</Code>,{" "}
								<Code>mismatch</Code>, <Code>unavailable</Code>, or{" "}
								<Code>not_applicable</Code>.
							</>,
						],
					]}
				/>
			</Section>

			<Group
				id="install-and-open-apps"
				text="Install, open, stop, and remove apps on a device."
				snippet={sh`agentsims app list --device android:emulator-5554
agentsims app install ./app.apk --device android:emulator-5554
agentsims app launch com.example.app --device android:emulator-5554
agentsims app stop com.example.app --device android:emulator-5554
agentsims app uninstall com.example.app --device android:emulator-5554`}
			/>

			<Group
				id="use-a-webcam-as-the-device-camera"
				text={
					<>
						List the webcams and select one. On Android, also give the camera
						face, then restart the emulator yourself.
					</>
				}
				snippet={sh`agentsims camera list --device <device-id>
agentsims camera use <webcam-id> --device <ios-device-id>
agentsims camera use webcam0 --face back --device android:emulator-5554
agentsims camera stop --device <ios-device-id>`}
			/>

			<Group
				id="change-app-permissions"
				text={
					<>
						<Code>--app</Code> takes an iOS bundle ID or an Android package
						name.
					</>
				}
				snippet={sh`agentsims permissions list --device <device-id> --app com.example.app
agentsims permissions grant camera --device <device-id> --app com.example.app
agentsims permissions revoke camera --device <device-id> --app com.example.app
agentsims permissions reset --device <device-id> --app com.example.app`}
			/>

			<Group
				id="read-app-logs"
				text={
					<>
						<Code>app-logs</Code> reads the logs of the foreground app.{" "}
						<Code>device-logs</Code> reads a fixed number of Android log lines.
					</>
				}
				snippet={sh`agentsims app-logs --device android:emulator-5554 --follow
agentsims app-logs --device android:emulator-5554 --level warn --query "camera"
agentsims device-logs --device android:emulator-5554 --limit 100`}
			/>

			<Group
				id="record-the-screen"
				text={
					<>
						If the device rotates, the recording continues in a new file.
					</>
				}
				snippet={sh`agentsims record start --device <device-id> --out ./run.mp4
agentsims record stop --device <device-id>`}
			/>

			<Group
				id="record-a-trace"
				text={
					<>
						A trace records each command, its result, and a screenshot in{" "}
						<Code>~/.agentsims/traces/&lt;trace-id&gt;/</Code>.
					</>
				}
				snippet={sh`agentsims trace start --device <device-id> --name checkout
agentsims trace stop --device <device-id>`}
			/>

			<Group
				id="wait-for-the-screen-and-run-steps"
				text={
					<>
						<Code>wait</Code> holds until text shows, text is gone, or the screen
						is stable. <Code>run</Code> does up to 25 steps from a JSON file.
					</>
				}
				snippet={sh`agentsims wait --for "Welcome" --device <device-id>
agentsims run steps.json --device <device-id>`}
			/>

			<Section id="command-reference" title={cliOutline["command-reference"]}>
				<Text>
					Each input command also accepts <Code>--screenshot</Code> and{" "}
					<Code>--json</Code>. For the full options of a command, run{" "}
					<Code>agentsims &lt;command&gt; --help</Code>.
				</Text>
				<DataTable
					head={["Command", "Arguments"]}
					mono={[0, 1]}
					rows={reference.map(([command, args]) => [
						command,
						<span className="whitespace-normal">{args}</span>,
					])}
				/>
			</Section>

			<Section id="observe-options" title={cliOutline["observe-options"]}>
				<DataTable
					head={["Option", "Result"]}
					mono={[0]}
					rows={[
						["-o <path>", "Saves the screenshot to this file."],
						["--all", "Includes the elements that the default output hides."],
						["--frames", "Adds the box of each element, in screenshot pixels."],
						["--raw", "Adds the platform class of each element."],
						["--json", "Prints structured output without image data."],
					]}
				/>
			</Section>
		</GuidePage>
	);
}
