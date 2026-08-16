import type { Command } from "commander";
import {
  button,
  observeDevice,
  readAccessibilityTree,
  rotate,
  tap,
  typeText,
} from "./device-control";
import { ApplicationCommandClient } from "./application-command-client";

type ServeOptions = {
  port?: number;
  host: string;
  codec?: string;
};

type RegisterApplicationCommandsOptions = {
  defaultHost: string;
  serve(devices: string[], options: ServeOptions): Promise<void>;
  stop(device?: string): void;
};

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(`agentsims: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function client(origin: string | undefined): ApplicationCommandClient {
  return new ApplicationCommandClient({ origin });
}

function requiredArgument(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function deviceHelp(deviceId: string | undefined, args: string[]): string {
  const device = deviceId ?? "<device>";
  const [group, action] = args;
  if (group === "camera") {
    if (action === "front" || action === "back") {
      return `Usage: agentsims device ${device} camera ${action} <source> [--url <url>]\n`;
    }
    if (action === "source") {
      return `Usage: agentsims device ${device} camera source <source> [value] [--url <url>]\n`;
    }
    return `Usage: agentsims device ${device} camera <command>\n\nCommands:\n  status\n  front <source>\n  back <source>\n  source <source> [value]\n`;
  }
  if (group === "audio") {
    if (action) {
      const value = action === "status" ? "" : action === "microphone" ? " <on|off>" : " <value>";
      return `Usage: agentsims device ${device} audio ${action}${value} [--url <url>]\n`;
    }
    return `Usage: agentsims device ${device} audio <command>\n\nCommands:\n  status\n  microphone <on|off>\n  input <host-input-id>\n  output <host-output-id>\n  volume <0..1>\n`;
  }
  if (group === "input") {
    if (action === "tap") return `Usage: agentsims device ${device} input tap <x> <y>\n`;
    if (action === "button") return `Usage: agentsims device ${device} input button [name]\n`;
    if (action === "type") return `Usage: agentsims device ${device} input type [text...]\n`;
    if (action === "rotate") {
      return `Usage: agentsims device ${device} input rotate <orientation>\n`;
    }
    return `Usage: agentsims device ${device} input <command>\n\nCommands:\n  tap <x> <y>\n  button [name]\n  type [text...]\n  rotate <orientation>\n`;
  }
  if (group === "ax") return `Usage: agentsims device ${device} ax tree\n`;
  if (group === "screenshot") {
    return `Usage: agentsims device ${device} screenshot [--output <path>]\n`;
  }
  if (group === "observe") {
    return `Usage: agentsims device ${device} observe [--output <path>] [--no-ax]\n`;
  }
  return `Usage: agentsims device <device> <command>\n\nCommands:\n  status\n  observe\n  screenshot\n  ax\n  camera\n  audio\n  input\n\nRun 'agentsims device <device> <command> --help' for more information.\n`;
}

export function registerApplicationCommands(
  program: Command,
  options: RegisterApplicationCommandsOptions,
): void {
  program
    .command("serve [devices...]")
    .description("Start the complete Agentsims workspace")
    .option("-p, --port <port>", "Web server port", (value) => Number(value))
    .option("--host <address>", "Web server address", options.defaultHost)
    .option("--codec <codec>", "Video codec: auto, h264, or mjpeg", "auto")
    .action((devices: string[], commandOptions: ServeOptions) =>
      run(() => options.serve(devices, commandOptions)),
    );

  program
    .command("status")
    .description("Show running Agentsims workspaces")
    .option("--url <url>", "Agentsims server URL")
    .action((commandOptions) =>
      run(async () => printJson(await client(commandOptions.url).status())),
    );

  program
    .command("stop [device]")
    .description("Stop one workspace or all workspaces")
    .action((device?: string) => options.stop(device));

  const devices = program.command("devices").description("Manage the device catalog");
  devices
    .command("list")
    .description("List all devices")
    .option("--url <url>", "Agentsims server URL")
    .action((commandOptions) =>
      run(async () => printJson(await client(commandOptions.url).listDevices())),
    );
  devices
    .command("boot <device>")
    .alias("start")
    .description("Boot a device and attach its stream")
    .option("--url <url>", "Agentsims server URL")
    .action((device: string, commandOptions) =>
      run(async () => printJson(await client(commandOptions.url).startDevice(device))),
    );
  devices
    .command("shutdown <device>")
    .description("Shut down a device")
    .option("--url <url>", "Agentsims server URL")
    .action((device: string, commandOptions) =>
      run(async () => printJson(await client(commandOptions.url).shutdownDevice(device))),
    );

  program
    .command("device [device] [device-command...]")
    .description("Inspect or control one device")
    .helpOption(false)
    .option("-h, --help", "Show help for this command")
    .option("--url <url>", "Agentsims server URL")
    .option("-o, --output <path>", "Screenshot output path")
    .option("--no-ax", "Do not capture accessibility data")
    .action((deviceId: string | undefined, args: string[], commandOptions) =>
      run(async () => {
        if (commandOptions.help) {
          process.stdout.write(deviceHelp(deviceId, args));
          return;
        }
        deviceId = requiredArgument(deviceId, "device");
        const appClient = client(commandOptions.url);
        const [group, action, ...values] = args;
        if (group === "status") {
          const page = (await appClient.listDevices()) as {
            devices?: Array<{ device?: string }>;
          };
          const record = page.devices?.find((item) => item.device === deviceId);
          if (!record) throw new Error(`Device ${deviceId} was not found`);
          printJson(record);
        } else if (group === "observe") {
          printJson(
            await observeDevice({
              device: deviceId,
              output: commandOptions.output,
              includeAccessibility: commandOptions.ax,
              origin: commandOptions.url,
            }),
          );
        } else if (group === "screenshot") {
          printJson(
            await observeDevice({
              device: deviceId,
              output: commandOptions.output,
              includeAccessibility: false,
              origin: commandOptions.url,
            }),
          );
        } else if (group === "ax" && action === "tree") {
          printJson(await readAccessibilityTree(deviceId, commandOptions.url));
        } else if (group === "camera") {
          if (action === "status") printJson(await appClient.media(deviceId));
          else if (action === "front" || action === "back") {
            printJson(
              await appClient.applyMedia(deviceId, {
                action: "android-camera-source",
                face: action,
                source: requiredArgument(values[0], "camera source"),
              }),
            );
          } else if (action === "source") {
            const source = requiredArgument(values[0], "camera source");
            const value = values[1];
            printJson(
              await appClient.applyMedia(deviceId, {
                action: "ios-camera-source",
                source,
                ...(source === "webcam" ? { deviceId: value } : value ? { path: value } : {}),
              }),
            );
          } else throw new Error("Use camera status, front, back, or source");
        } else if (group === "audio") {
          if (action === "status") printJson(await appClient.media(deviceId));
          else if (action === "microphone") {
            const state = requiredArgument(values[0], "microphone state");
            if (state !== "on" && state !== "off") throw new Error("State must be on or off");
            printJson(
              await appClient.applyMedia(deviceId, {
                action: "android-host-microphone",
                enabled: state === "on",
              }),
            );
          } else if (action === "input" || action === "output") {
            printJson(
              await appClient.applyMedia(deviceId, {
                action: `host-audio-${action}`,
                deviceId: requiredArgument(values[0], `audio ${action} device`),
              }),
            );
          } else if (action === "volume") {
            printJson(
              await appClient.applyMedia(deviceId, {
                action: "audio-output-volume",
                volume: Number(requiredArgument(values[0], "volume")),
              }),
            );
          } else throw new Error("Use audio status, microphone, input, output, or volume");
        } else if (group === "input") {
          if (action === "tap") {
            await tap(
              requiredArgument(values[0], "x coordinate"),
              requiredArgument(values[1], "y coordinate"),
              deviceId,
              commandOptions.url,
            );
          } else if (action === "button") {
            await button(values[0] ?? "home", deviceId, commandOptions.url);
          } else if (action === "type") {
            await typeText(values, { device: deviceId, origin: commandOptions.url });
          } else if (action === "rotate") {
            await rotate(requiredArgument(values[0], "orientation"), deviceId, commandOptions.url);
          } else throw new Error("Use input tap, button, type, or rotate");
        } else {
          throw new Error("Unknown device command. Use `agentsims device --help` for help");
        }
      }),
    );
}
