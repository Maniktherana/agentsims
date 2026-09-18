import type { Command } from "commander";
import type { ActionResult } from "../../core/tools/actions";
import { AX_ROLES } from "../../core/tools/observe/ax-view";
import {
	DEFAULT_DRAG_DURATION_MS,
	DEFAULT_SCROLL_AMOUNT,
	DEFAULT_SCROLL_DURATION_MS,
	MAX_SCROLL_PAGES,
	SCROLL_DIRECTIONS,
	type ScrollDirection,
	type ScrollResult,
} from "../../core/tools/scroll";
import { renderScrollResult, scrollForOutput } from "../observe-output";
import {
	actionExitCode,
	clientOf,
	deviceCommand,
	integerOption,
	oneOfOption,
	positiveIntegerOption,
	printActionResult,
	printJson,
	watchOptions,
	watchRequest,
	watchTimeout,
	writeActionImage,
	writerOf,
	type ActionFlags,
	type CommandDependencies,
} from "./shared";

type ScrollFlags = ActionFlags & {
	in?: string;
	amount: number;
	duration: number;
	toEnd?: boolean;
	collect?: string;
	maxPages: number;
};

type DragFlags = ActionFlags & {
	duration: number;
	capture?: string;
	role?: string;
	index?: number;
};

/** A long scroll walks the whole list, so it needs more than one request. */
const SCROLL_TIMEOUT_MS = 10 * 60_000;

export function registerScrollCommands(
	program: Command,
	dependencies: CommandDependencies = {},
): Command {
	const client = clientOf(dependencies);
	const write = writerOf(dependencies);

	deviceCommand(
		program,
		"scroll <direction>",
		`Scroll a region one page: ${SCROLL_DIRECTIONS.join(", ")}`,
	)
		.option("--json", "Print structured output")
		.option(
			"--in <target>",
			"Scroll inside this region. A ref (@e14) or an exact label",
		)
		.option(
			"--amount <percent>",
			`Percent of the region to travel (default: ${DEFAULT_SCROLL_AMOUNT})`,
			integerOption("Amount", 1, 100),
			DEFAULT_SCROLL_AMOUNT,
		)
		.option(
			"--duration <ms>",
			`Swipe duration in milliseconds (default: ${DEFAULT_SCROLL_DURATION_MS})`,
			integerOption("Duration", 1, 5_000),
			DEFAULT_SCROLL_DURATION_MS,
		)
		.option("--to-end", "Keep scrolling until the region stops changing")
		.option(
			"--collect <selector>",
			`Collect matching nodes from every page. A role (${AX_ROLES.join(", ")}), a test ID, or an exact label`,
		)
		.option(
			"--max-pages <count>",
			`Page limit for --to-end (default: ${MAX_SCROLL_PAGES})`,
			integerOption("Max pages", 1, MAX_SCROLL_PAGES),
			MAX_SCROLL_PAGES,
		)
		.addHelpText(
			"after",
			`
Direction:
  The content moves the way you scroll. scroll down reads further down a list.

Examples:
  One page:    agentsims scroll down -d <id>
  One region:  agentsims scroll down --in @e14 -d <id>
  Whole list:  agentsims scroll down --to-end --collect cell -d <id>
`,
		)
		.action(async (direction: string, flags: ScrollFlags) => {
			const result = (await client(flags.url, {
				timeoutMs: SCROLL_TIMEOUT_MS,
			}).scrollDevice(flags.device, {
				direction: oneOfOption<ScrollDirection>(
					"Direction",
					SCROLL_DIRECTIONS,
				)(direction),
				...(flags.in ? { in: flags.in } : {}),
				amount: flags.amount,
				durationMs: flags.duration,
				...(flags.toEnd ? { toEnd: true } : {}),
				...(flags.collect ? { collect: flags.collect } : {}),
				maxPages: flags.maxPages,
			})) as ScrollResult;
			const artifact = writeActionImage(result.action.image, flags.device);
			actionExitCode(result.action, artifact);
			if (flags.json) return printJson(write, scrollForOutput(result, artifact));
			write(`${renderScrollResult(result, artifact)}\n`);
		});

	watchOptions(
		deviceCommand(
			program,
			"drag <from> <to>",
			"Move one finger slowly between two targets, for a slider or a reorder",
		)
			.option("--json", "Print structured output")
			.option("--screenshot", "Capture the screen after the action")
			.option("--capture <id>", "Capture ID for a pixel or percent point")
			.option("--role <role>", `Match only this role: ${AX_ROLES.join(", ")}`)
			.option(
				"--index <n>",
				"Choose one of several matches, counted from 1",
				positiveIntegerOption("Index"),
			)
			.option(
				"--duration <ms>",
				`Drag duration in milliseconds (default: ${DEFAULT_DRAG_DURATION_MS})`,
				integerOption("Duration", 1, 5_000),
				DEFAULT_DRAG_DURATION_MS,
			),
	).action(async (from: string, to: string, flags: DragFlags) => {
		const watch = watchRequest(flags);
		const timeoutMs = watchTimeout(flags);
		const result = (await client(
			flags.url,
			timeoutMs === undefined ? {} : { timeoutMs },
		).actDevice(
			flags.device,
			[
				{
					type: "swipe",
					from,
					to,
					durationMs: flags.duration,
					...(flags.capture ? { capture: flags.capture } : {}),
					...(flags.role ? { role: flags.role } : {}),
					...(flags.index === undefined ? {} : { index: flags.index }),
				},
			],
			{
				screenshot: flags.screenshot === true,
				...(watch ? { watch } : {}),
			},
		)) as ActionResult;
		printActionResult(dependencies, flags, result);
	});

	return program;
}
