/** The tools of the workspace, as docs/workspace.md describes them. The Overview lists them; the tour captions them. */
export const WORKSPACE_TOOLS = [
	{
		id: "workspace-devices",
		name: "Devices",
		text: "Boot and stream simulators and emulators from the dock.",
	},
	{
		id: "workspace-inspector",
		name: "Inspector",
		text: "See each native element on the screen and its properties in the accessibility view.",
	},
	{
		id: "workspace-settings",
		name: "Settings",
		text: "Change appearance and location on iOS, and network, battery, and locale on Android.",
	},
	{
		id: "workspace-notes",
		name: "Notes",
		text: "Mark problems on the screen and copy them to your agent as one prompt.",
	},
	{
		id: "workspace-logs-and-traces",
		name: "Logs and traces",
		text: "Read the logs of each device, and see each command with the screenshot and output it captured.",
	},
] as const;
