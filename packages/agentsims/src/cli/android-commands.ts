import { cliAction } from "./error";
import { readFile } from "node:fs/promises";
import type { Command } from "commander";
import type {
	AndroidToolAction,
	AndroidLogEvent,
} from "../android/contracts";
import { ApplicationCommandClient } from "./application-command-client";

type AndroidOptions = {
	url?: string;
	level?: string;
	package?: string;
	pid?: string;
	query?: string;
};
const json = (value: unknown) =>
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
const required = (value: string | undefined, name: string) => {
	if (!value) throw new Error(`${name} is required`);
	return value;
};

export function androidCliAction(
	operation: string,
	args: string[],
	options: AndroidOptions,
): AndroidToolAction {
	switch (operation) {
		case "apps":
			return { type: "apps" };
		case "launch":
		case "stop":
		case "clear":
		case "uninstall":
			return { type: "app", operation, package: required(args[0], "Package") };
		case "link":
			return {
				type: "link",
				url: required(args[0], "URL"),
				package: options.package,
			};
		case "snapshot": {
			const action = required(args[0], "Snapshot operation");
			if (
				action !== "list" &&
				action !== "save" &&
				action !== "load" &&
				action !== "delete"
			)
				throw new Error("Use snapshot list, save, load, or delete");
			return { type: "snapshot", operation: action, name: args[1] };
		}
		case "density":
			return {
				type: "density",
				dpi: args[0] === "reset" ? "reset" : Number(required(args[0], "DPI")),
			};
		case "locale":
			return {
				type: "locale",
				package: required(options.package ?? args[0], "Package"),
				locale: (options.package ? args[0] : args[1]) ?? "",
			};
		case "talkback":
			if (args[0] !== "on" && args[0] !== "off")
				throw new Error("Use talkback on or off");
			return { type: "talkback", enabled: args[0] === "on" };
		case "location":
			return {
				type: "location",
				latitude: Number(required(args[0], "Latitude")),
				longitude: Number(required(args[1], "Longitude")),
				altitude: args[2] === undefined ? undefined : Number(args[2]),
			};
		case "network":
		case "battery":
		case "settings":
		case "call":
		case "sms": {
			const fields: unknown = JSON.parse(required(args[0], "JSON options"));
			if (!fields || typeof fields !== "object" || Array.isArray(fields))
				throw new Error("Options must be a JSON object");
			return { ...fields, type: operation } as AndroidToolAction;
		}
		default:
			throw new Error(
				`Unknown Android command: ${operation}. Run agentsims android --help.`,
			);
	}
}

async function followLogs(
	device: string,
	options: AndroidOptions,
): Promise<void> {
	const query = new URLSearchParams({ device });
	for (const key of ["level", "package", "pid", "query"] as const)
		if (options[key]) query.set(key, options[key]);
	const controller = new AbortController();
	const stop = () => controller.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	try {
		const response = await fetch(
			`${(options.url ?? "http://127.0.0.1:3200").replace(/\/$/, "")}/android/logs?${query}`,
			{ signal: controller.signal },
		);
		if (!response.ok || !response.body) throw new Error(await response.text());
		const reader = response.body
			.pipeThrough(new TextDecoderStream())
			.getReader();
		let pending = "";
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			pending += part.value;
			let end: number;
			while ((end = pending.indexOf("\n\n")) >= 0) {
				const frame = pending.slice(0, end);
				pending = pending.slice(end + 2);
				const data = frame
					.split("\n")
					.find((line) => line.startsWith("data: "));
				if (!data) continue;
				const event = JSON.parse(data.slice(6)) as
					| AndroidLogEvent
					| { error: string };
				if ("error" in event) throw new Error(event.error);
				if (event.type === "lines")
					for (const line of event.lines)
						process.stdout.write(
							`${line.time} ${line.pid} ${line.level} ${line.tag}: ${line.message}\n`,
						);
				else if (event.state === "reconnecting")
					process.stderr.write(`${event.message ?? "Reconnecting logcat"}\n`);
			}
		}
	} catch (error) {
		if (!controller.signal.aborted) throw error;
	} finally {
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
	}
}

export function registerAndroidCommands(program: Command): void {
	program
		.command("android")
		.description("Android apps, logs, and device controls")
		.argument("<device>", "Android serial or android:<serial>")
		.argument(
			"<operation>",
			"apps | install | launch | stop | clear | uninstall | link | logs | capabilities | snapshot | network | battery | density | locale | talkback | location | settings | call | sms",
		)
		.argument("[args...]")
		.option("--url <url>", "Agentsims server URL")
		.option("--package <package>", "Target app or filter logs by app")
		.option("--pid <pid>", "Filter logs by PID")
		.option("--level <level>", "Minimum log severity: V D I W E F")
		.option("--query <text>", "Filter log messages")
		.addHelpText(
			"after",
			'\nExamples:\n  agentsims android emulator-5554 logs --package com.example.app\n  agentsims android emulator-5554 install ./app.apk\n  agentsims android emulator-5554 snapshot save signed-in\n  agentsims android emulator-5554 network \'{"speed":"edge","delay":"edge"}\'\n  agentsims android emulator-5554 battery \'{"level":10,"charging":false}\'\n',
		)
		.action(
			cliAction(
				async (
					device: string,
					operation: string,
					args: string[],
					options: AndroidOptions,
				) => {
					const client = new ApplicationCommandClient({ origin: options.url });
					if (operation === "logs") {
						await followLogs(device, options);
						return;
					}
					if (operation === "capabilities") {
						json(await client.android(device, "capabilities"));
						return;
					}
					if (operation === "install") {
						const file = required(args[0], "APK path");
						if (!file.toLowerCase().endsWith(".apk"))
							throw new Error("Install requires an APK file");
						json(
							await client.android(device, "install", {
								method: "POST",
								headers: {
									"Content-Type": "application/vnd.android.package-archive",
								},
								body: await readFile(file),
							}),
						);
						return;
					}
					json(
						await client.android(device, "command", {
							method: "POST",
							body: JSON.stringify(androidCliAction(operation, args, options)),
						}),
					);
				},
			),
		);
}
