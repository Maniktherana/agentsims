import { createFileRoute, Link } from "@tanstack/react-router";
import { js, sh } from "../code/tags";
import { CommandBlock } from "../components/installation/command-block";
import {
	Code,
	DataTable,
	GuidePage,
	Section,
	Text,
	textLink,
} from "../components/page";

export const Route = createFileRoute("/react-native")({
	head: () => ({ meta: [{ title: "React Native · Agentsims" }] }),
	component: ReactNativePage,
});

const metroConfig = js`const { getDefaultConfig } = require("expo/metro-config");
const { withAgentsims } = require("agentsims/metro");

const config = getDefaultConfig(__dirname);

module.exports = withAgentsims(config);`;

const previewConfig = js`module.exports = withAgentsims(getDefaultConfig(__dirname), {
	preview: true,
});`;

/** The section titles, by heading id, in page order. */
const contents = {
	"connect": "Connect",
	"open-the-workspace-from-metro": "Open the workspace from Metro",
	"package-exports": "Package exports",
} as const;

function ReactNativePage() {
	return (
		<GuidePage
			title="React Native"
			lead="Component names and source files in the inspector."
			contents={contents}
		>

			<Section id="connect" title={contents["connect"]}>
				<Text>
					Add the Metro plugin to a React Native or Expo app. You need Node.js
					20 or newer. The <Code>agentsims</Code> npm package does not include
					the CLI.{" "}
					<Link to="/installation" className={textLink}>
						Install Agentsims
					</Link>{" "}
					separately.
				</Text>
				<Text>Install the package in the app project.</Text>
				<CommandBlock
					snippet={sh`npm install --save-dev agentsims`}
					label="Copy install command"
				/>
				<Text>
					Wrap the Metro configuration in <Code>metro.config.js</Code> with{" "}
					<Code>withAgentsims</Code>. Then restart Metro and reload the app.
				</Text>
				<CommandBlock snippet={metroConfig} label="Copy configuration" />
				<Text>
					For a bare React Native app, wrap the result of{" "}
					<Code>mergeConfig</Code>. Put <Code>withAgentsims</Code> outside
					other wrappers.
				</Text>
			</Section>

			<Section id="open-the-workspace-from-metro" title={contents["open-the-workspace-from-metro"]}>
				<Text>
					Metro can start its own Agentsims process. When Metro stops, it
					stops that process too. Metro never stops a process that you
					started yourself.
				</Text>
				<Text>
					Set <Code>preview: true</Code> in <Code>withAgentsims</Code>, then
					start Metro.
				</Text>
				<CommandBlock snippet={previewConfig} label="Copy configuration" />
				<Text>
					Open <Code>/.sim</Code> on the Metro server, for example{" "}
					<Code>http://localhost:8081/.sim</Code>.
				</Text>
			</Section>

			<Section id="package-exports" title={contents["package-exports"]}>
				<Text>
					The <Code>agentsims</Code> npm package contains only the Metro and
					Babel plugins.
				</Text>
				<DataTable
					head={["Export", "Purpose"]}
					mono={[0]}
					rows={[
						["agentsims/metro", "The Metro configuration wrapper"],
						["agentsims/babel-plugin", "The Babel plugin that records source locations"],
						["agentsims/state", "The device state API"],
					]}
				/>
			</Section>
		</GuidePage>
	);
}
