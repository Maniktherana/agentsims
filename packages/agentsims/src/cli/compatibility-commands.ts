import type { Command } from "commander";
import {
  actOnDevice,
  button,
  gesture,
  observeDevice,
  parseAgentAction,
  rotate,
  tap,
  typeText,
} from "./device-control";

const DEVICE_OPTION = [
  "-d, --device <id>",
  "Target a running device id from `agentsims --list`",
] as const;

const URL_OPTION = ["--url <url>", "Agentsims server URL"] as const;

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(
      `agentsims: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

export function addCompatibilityCommands(program: Command): void {
  program
    .command("observe")
    .description(
      "Capture one screenshot plus screen and accessibility metadata as JSON",
    )
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .option("-o, --output <path>", "Write the screenshot to this path")
    .option("--no-ax", "Skip accessibility metadata")
    .action((options) =>
      run(async () => {
        const observation = await observeDevice({
          device: options.device,
          output: options.output,
          includeAccessibility: options.ax,
          origin: options.url,
        });
        process.stdout.write(`${JSON.stringify(observation, null, 2)}\n`);
      }),
    );

  program
    .command("act")
    .description(
      "Execute one JSON action: tap, gesture, swipe, type, button, or rotate",
    )
    .argument("<json>", "Structured action JSON")
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .action((json: string, options) =>
      run(() => actOnDevice(parseAgentAction(json), options.device, options.url)),
    );

  program
    .command("gesture")
    .description("Send one raw touch phase")
    .argument(
      "<json>",
      'Gesture JSON, e.g. \'{"type":"begin","x":0.5,"y":0.5}\'',
    )
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .action((json: string, options) =>
      run(() => gesture(json, options.device, options.url)),
    );

  program
    .command("tap")
    .description("Tap at normalized 0..1 coordinates")
    .argument("<x>", "X coordinate, normalized 0..1")
    .argument("<y>", "Y coordinate, normalized 0..1")
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .action((x: string, y: string, options) =>
      run(() => tap(x, y, options.device, options.url)),
    );

  program
    .command("button")
    .description("Send a hardware button press")
    .argument("[name]", "Button name", "home")
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .action((name: string, options) =>
      run(() => button(name, options.device, options.url)),
    );

  program
    .command("type")
    .description("Type text using the US keyboard layout")
    .argument("[text...]", "Text to type")
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .option("--stdin", "Read text from stdin")
    .option("--file <path>", "Read text from a file")
    .action((text: string[], options) =>
      run(() =>
        typeText(text, {
          device: options.device,
          stdin: options.stdin,
          file: options.file,
          origin: options.url,
        }),
      ),
    );

  program
    .command("rotate")
    .description(
      "Set orientation: portrait, portrait_upside_down, landscape_left, or landscape_right",
    )
    .argument("<orientation>")
    .option(...DEVICE_OPTION)
    .option(...URL_OPTION)
    .action((orientation: string, options) =>
      run(() => rotate(orientation, options.device, options.url)),
    );
}
