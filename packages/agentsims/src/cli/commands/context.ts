import { readFile, stat } from "node:fs/promises";
import type { Command } from "commander";
import { parseContextInput } from "../../core/tools/context/input";
import {
	clientOf,
	printJson,
	writerOf,
	type CommandDependencies,
} from "./shared";

type Flags = { workspace: string; url?: string; device?: string };

export function registerContextCommands(
	program: Command,
	dependencies: CommandDependencies = {},
): Command {
	const client = clientOf(dependencies);
	const write = writerOf(dependencies);
	const group = program
		.command("context")
		.description("Read or export captured annotation and log evidence");
	const command = (name: string, description: string) =>
		group
			.command(name)
			.description(description)
			.requiredOption("--workspace <id>")
			.option("--url <url>");
	command("list", "List captured evidence in a workspace")
		.option("-d, --device <id>")
		.action(async (flags: Flags) =>
			printJson(
				write,
				await client(flags.url).listContext(flags.workspace, flags.device),
			),
		);
	command("add <file>", "Create a draft from captured evidence JSON").action(
		async (file: string, flags: Flags) => {
			if ((await stat(file)).size > 12 * 1024 * 1024)
				throw new Error("Context file exceeds 12 MiB.");
			const content = await readFile(file, "utf8");
			if (Buffer.byteLength(content) > 12 * 1024 * 1024)
				throw new Error("Context file exceeds 12 MiB.");
			const input = parseContextInput(JSON.parse(content));
			printJson(
				write,
				await client(flags.url).createContext(flags.workspace, input),
			);
		},
	);
	command(
		"note <id> <text>",
		"Edit a note without changing captured evidence",
	).action(async (id: string, text: string, flags: Flags) =>
		printJson(
			write,
			await client(flags.url).updateContext(flags.workspace, id, text),
		),
	);
	command("save <id>", "Save a captured draft").action(
		async (id: string, flags: Flags) =>
			printJson(
				write,
				await client(flags.url).saveContext(flags.workspace, id),
			),
	);
	command("remove <id>", "Remove captured evidence").action(
		async (id: string, flags: Flags) =>
			printJson(
				write,
				await client(flags.url).removeContext(flags.workspace, id),
			),
	);
	command(
		"export <ids...>",
		"Export selected notes, screenshots, source, and logs",
	).action(async (ids: string[], flags: Flags) =>
		printJson(
			write,
			await client(flags.url).exportContext(flags.workspace, ids),
		),
	);
	return program;
}
