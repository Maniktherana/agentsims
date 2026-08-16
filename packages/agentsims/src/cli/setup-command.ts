import { createInterface } from "readline/promises";
import type { Command } from "commander";
import {
	applyMetroSetup,
	formatMetroSetupDiff,
	MetroSetupError,
	planMetroSetup,
	type MetroSetupInput,
	type MetroSetupSystem,
} from "./metro-setup";

export interface SetupCommandOptions {
	project?: string;
	config?: string;
	dryRun?: boolean;
	yes?: boolean;
}

export interface SetupCommandIO {
	stdin: NodeJS.ReadableStream & { isTTY?: boolean };
	stdout: NodeJS.WritableStream;
	stderr: NodeJS.WritableStream;
	confirm?(question: string): Promise<boolean>;
}

const processIO: SetupCommandIO = {
	stdin: process.stdin,
	stdout: process.stdout,
	stderr: process.stderr,
};

async function confirmSetup(io: SetupCommandIO): Promise<boolean> {
	if (io.confirm) return io.confirm("Apply this change? [y/N] ");
	const prompt = createInterface({ input: io.stdin, output: io.stdout });
	try {
		const answer = await prompt.question("Apply this change? [y/N] ");
		return /^(?:y|yes)$/i.test(answer.trim());
	} finally {
		prompt.close();
	}
}

function setupInput(options: SetupCommandOptions): MetroSetupInput {
	return {
		...(options.project ? { project: options.project } : {}),
		...(options.config ? { config: options.config } : {}),
	};
}

export function setupOptionsForProjectPath(
	projectPath: string | undefined,
	options: SetupCommandOptions,
): SetupCommandOptions {
	if (projectPath && options.project && projectPath !== options.project) {
		throw new MetroSetupError(
			"Use either the setup project path or --project, not both.",
		);
	}
	return { ...options, ...(projectPath ? { project: projectPath } : {}) };
}

export async function runSetupCommand(
	options: SetupCommandOptions,
	io: SetupCommandIO = processIO,
	system?: MetroSetupSystem,
): Promise<void> {
	const plan = system
		? planMetroSetup(setupInput(options), system)
		: planMetroSetup(setupInput(options));
	if (plan.status === "already-configured") {
		io.stdout.write(
			`Agentsims source mapping is already configured in ${plan.configPath}.\n`,
		);
		return;
	}

	io.stdout.write(
		`${plan.original === null ? "Create" : "Update"} ${plan.configPath}\n\n` +
			`${formatMetroSetupDiff(plan)}\n\n`,
	);
	if (options.dryRun) {
		io.stdout.write("Dry run complete. No files changed.\n");
		return;
	}

	if (!options.yes) {
		if (io.stdin.isTTY !== true && !io.confirm) {
			throw new MetroSetupError(
				"Setup needs confirmation in a non-interactive terminal. Re-run with --yes or --dry-run.\n" +
					"No files changed.",
			);
		}
		if (!(await confirmSetup(io))) {
			io.stdout.write("No files changed.\n");
			return;
		}
	}

	const applied = system
		? applyMetroSetup(plan, system)
		: applyMetroSetup(plan);
	io.stdout.write(
		`Configured Agentsims source mapping in ${applied.configPath}.\n`,
	);
	if (applied.backupPath) {
		io.stdout.write(`Backup: ${applied.backupPath}\n`);
	}
	io.stdout.write("Restart Metro to activate source mapping.\n");
}

export function addSetupCommand(program: Command): void {
	program
		.command("setup [project-path]")
		.description("Configure opt-in React Native and Expo source mapping")
		.option(
			"--project <directory>",
			"Expo or React Native app directory (legacy form)",
		)
		.option(
			"--config <file>",
			"Metro config path, relative to the app directory",
		)
		.option("--dry-run", "Print the proposed diff without writing files")
		.option("-y, --yes", "Apply the proposed change without prompting")
		.action(
			async (projectPath: string | undefined, options: SetupCommandOptions) => {
				try {
					await runSetupCommand(
						setupOptionsForProjectPath(projectPath, options),
					);
				} catch (error) {
					process.stderr.write(
						`agentsims setup: ${error instanceof Error ? error.message : String(error)}\n`,
					);
					process.exitCode = 1;
				}
			},
		);
}
