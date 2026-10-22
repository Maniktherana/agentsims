import type { Command } from "commander";

export const SKILL_SOURCE = "Maniktherana/agentsims";

export type SkillFlags = { global?: boolean; agent?: string; yes?: boolean };

/** The arguments for npx. `-y` lets npx fetch the skills CLI without a prompt. */
export function skillInstallArguments(flags: SkillFlags = {}): string[] {
	return [
		"-y",
		"skills",
		"add",
		SKILL_SOURCE,
		"--skill",
		"agentsims",
		...(flags.global ? ["--global"] : []),
		...(flags.agent ? ["--agent", flags.agent] : []),
		...(flags.yes ? ["--yes"] : []),
	];
}

async function runNpx(args: string[]): Promise<number> {
	const npx = Bun.which("npx");
	if (!npx)
		throw new Error(
			"Node.js 20 or newer is necessary to install the skill. Install Node.js, then run: agentsims skill",
		);
	const child = Bun.spawn([npx, ...args], {
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	});
	return await child.exited;
}

export function registerSkillCommands(program: Command): Command {
	program
		.command("skill")
		.description(
			"Install the Agentsims skill for Claude Code, Codex, Cursor, and other coding agents",
		)
		.option("-g, --global", "Install for your user instead of this project")
		.option("-a, --agent <agents>", "Install only for these agents")
		.option("-y, --yes", "Do not ask questions")
		.action(async (flags: SkillFlags) => {
			const code = await runNpx(skillInstallArguments(flags));
			if (code !== 0) process.exitCode = code;
		});
	return program;
}
