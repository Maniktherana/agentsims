import type { Command } from "commander";
import {
	startMcpStdio,
	type ManagedRuntime,
	type McpStdioSession,
} from "../../server/mcp/stdio";

export type McpCommandDependencies = {
	version: string;
	startRuntime: () => Promise<ManagedRuntime>;
	existingRuntime?: () => string | undefined;
	run?: (session: McpStdioSession) => Promise<void>;
};

export function registerMcpCommands(
	program: Command,
	dependencies: McpCommandDependencies,
): Command {
	program
		.command("mcp")
		.description("Serve local device tools and retained context over MCP stdio")
		.option("--url <url>", "Attach to an existing local Agentsims runtime")
		.action(async (flags: { url?: string }) => {
			const session = startMcpStdio({
				version: dependencies.version,
				startRuntime: dependencies.startRuntime,
				existingRuntime: dependencies.existingRuntime,
				origin: flags.url,
			});
			if (dependencies.run) await dependencies.run(session);
			else await session.closed;
		});
	return program;
}
