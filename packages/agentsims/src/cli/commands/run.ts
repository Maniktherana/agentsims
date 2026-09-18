import { readFileSync } from "node:fs";
import type { Command } from "commander";
import {
	MAX_SEQUENCE_STEPS,
	parseSequenceSteps,
	type SequenceResult,
} from "../../core/tools/sequence";
import type { ApplicationCommandClient } from "../application-command-client";
import { actionForOutput, renderSequenceResult } from "../observe-output";
import { actionExitCode, writeActionImage } from "./shared";

export type RunCommandDependencies = {
	client: (url?: string) => ApplicationCommandClient;
	json: (value: unknown) => void;
};

type RunFlags = {
	device: string;
	url?: string;
	json?: boolean;
	screenshot?: boolean;
};

const EXAMPLE = `
Steps:
  A step is one of the actions that agentsims already takes:
  {"type":"tap","target":"New Recipe"}
  {"type":"long-press","target":"Pasta","durationMs":900}
  {"type":"swipe","from":"50%,80%","to":"50%,20%"}
  {"type":"type","text":"Pasta","into":"Title","submit":true}
  {"type":"fill","text":"12","into":"Servings"}
  {"type":"button","button":"back"}
  {"type":"wait","ms":800}
  Add "label" to any step to name it in the output.

Targets:
  A target is an exact label ("Search") or a percent point (50%,90%).
  Refs (@e14), pixel points, and capture IDs belong to one observation, so a
  sequence refuses them.

Example:
  echo '[{"type":"tap","target":"New Recipe"},{"type":"type","text":"Pasta","into":"Title"}]' |
    agentsims run - -d <id>
`;

function readSteps(source: string): unknown {
	const where = source === "-" ? "Standard input" : source;
	let text: string;
	try {
		text = readFileSync(source === "-" ? 0 : source, "utf8");
	} catch (error) {
		throw new Error(
			`Cannot read ${where}. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new Error(
			`${where} must hold a JSON array of steps. ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export function registerRunCommands(
	program: Command,
	dependencies: RunCommandDependencies,
): void {
	program
		.command("run <source>")
		.description(
			`Run up to ${MAX_SEQUENCE_STEPS} steps from a JSON file, or - for standard input`,
		)
		.requiredOption("-d, --device <id>")
		.option("--url <url>")
		.option("--json", "Print structured output")
		.option("--screenshot", "Capture the screen after each step")
		.addHelpText("after", EXAMPLE)
		.action(async (source: string, flags: RunFlags) => {
			const steps = parseSequenceSteps(readSteps(source));
			const result = (await dependencies
				.client(flags.url)
				.runSequence(flags.device, steps, {
					screenshot: flags.screenshot === true,
				})) as SequenceResult;
			// Every step goes through the same artifact and exit-status path as a
			// single action, so a saved image and a failed step are never hidden.
			const artifacts = result.steps.map((step) =>
				writeActionImage(step.result.image, flags.device),
			);
			result.steps.forEach((step, index) =>
				actionExitCode(step.result, artifacts[index] ?? null),
			);
			if (result.stoppedAt !== null) process.exitCode = 1;
			if (flags.json)
				return dependencies.json({
					...result,
					steps: result.steps.map((step, index) => ({
						...step,
						result: actionForOutput(step.result, artifacts[index] ?? null),
					})),
				});
			process.stdout.write(`${renderSequenceResult(result, {}, artifacts)}\n`);
		});
}
