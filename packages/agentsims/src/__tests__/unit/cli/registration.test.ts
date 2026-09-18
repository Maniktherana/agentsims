import { expect, spyOn, test } from "bun:test";
import { Command } from "commander";
import type { ApplicationCommandClient } from "../../../cli/application-command-client";
import { registerScrollCommands } from "../../../cli/commands/scroll";
import { createProgram } from "../../../cli/main";

function program() {
	const root = createProgram();
	const override = (value: Command): void => {
		value.exitOverride();
		for (const child of value.commands) override(child);
	};
	override(root);
	return root;
}

/** The refusal names the flags that were given, in the order they are read. */
function message(args: readonly string[]): string {
	const named = args.filter((value) => value.startsWith("--"));
	return `${named.join(", ")} needs --watch <ms>.`;
}

function command(name: string): Command {
	const value = program().commands.find((item) => item.name() === name);
	if (!value) throw new Error(`Missing command: ${name}`);
	return value;
}

test("the public command surface is canonical", () => {
	const names = program().commands
		.filter((item) => !["serve"].includes(item.name()))
		.map((item) => item.name());
	expect(names).toEqual([
		"start",
		"stop",
		"status",
		"logs",
		"device-logs",
		"devices",
		"tap",
		"long-press",
		"swipe",
		"scroll",
		"drag",
		"type",
		"fill",
		"press",
		"rotate",
		"run",
		"record",
		"observe",
		"screenshot",
		"wait",
		"find",
		"camera",
		"app",
		"permissions",
		"doctor",
		"trace",
	]);
	expect(command("device-logs").aliases()).toEqual([]);
	expect(command("camera").commands.find((item) => item.name() === "list")?.aliases()).toEqual([]);
	expect(command("camera").commands.find((item) => item.name() === "use")?.aliases()).toEqual([]);
});

/** An action that can watch its own effect takes the same five flags. */
const WATCH_OPTIONS = [
	"--watch",
	"--samples",
	"--every",
	"--keep-frames",
];

test("action and app help shows the supported options", () => {
	const expected: Record<string, string[]> = {
		tap: ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", ...WATCH_OPTIONS],
		"long-press": ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", "--duration", ...WATCH_OPTIONS],
		swipe: ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", "--duration", ...WATCH_OPTIONS],
		scroll: ["--device", "--url", "--json", "--in", "--amount", "--duration", "--to-end", "--collect", "--max-pages"],
		drag: ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", "--duration", ...WATCH_OPTIONS],
		type: ["--device", "--url", "--json", "--screenshot", "--into", "--capture", "--role", "--index", "--submit"],
		fill: ["--device", "--url", "--json", "--screenshot", "--into", "--capture", "--role", "--index", "--submit"],
		press: ["--device", "--url", "--json", "--screenshot", ...WATCH_OPTIONS],
		rotate: ["--device", "--url", "--json", "--screenshot"],
	};
	for (const [name, options] of Object.entries(expected))
		expect(command(name).options.map((option) => option.long)).toEqual(options);

	const run = command("run");
	expect(run.options.map((option) => option.long)).toEqual([
		"--device",
		"--url",
		"--json",
		"--screenshot",
	]);
	const runHelp = run.helpInformation().replace(/\s+/g, " ");
	expect(runHelp).toContain("--json");
	expect(runHelp).toContain("Run up to 25 steps from a JSON file");
	expect(runHelp).toContain("- for standard input");

	const app = command("app");
	const appOptions = (name: string) =>
		app.commands
			.find((item) => item.name() === name)
			?.options.map((option) => option.long);
	expect(appOptions("launch")).toEqual([
		"--device",
		"--url",
		"--json",
		"--screenshot",
		...WATCH_OPTIONS,
	]);
	expect(appOptions("stop")).toEqual([
		"--device",
		"--url",
		"--json",
		"--screenshot",
	]);
});

test.each([
	["tap", ["tap", "@e1", "--samples", "4"], "--samples needs --watch <ms>."],
	["drag", ["drag", "@e1", "@e2", "--keep-frames"], "--keep-frames needs --watch <ms>."],
])("%s refuses sampling flags without a window", async (_name, args) => {
	await expect(
		program().parseAsync([...args, "-d", "android:emulator-5554"], {
			from: "user",
		}),
	).rejects.toThrow(message(args));
});

test("a watched action takes a sample count or an interval, never both", async () => {
	await expect(
		program().parseAsync(
			[
				"tap",
				"@e1",
				"-d",
				"android:emulator-5554",
				"--watch",
				"9000",
				"--samples",
				"8",
				"--every",
				"250",
			],
			{ from: "user" },
		),
	).rejects.toThrow(/cannot be used with option/);
});

test("timed observation help lists the sampling and waiting options", () => {
	const observe = command("observe").options.map((option) => option.long);
	expect(observe).toContain("--watch");
	expect(observe).toContain("--samples");
	expect(observe).toContain("--every");
	expect(observe).toContain("--keep-frames");
	expect(observe).toContain("--frames");

	const wait = command("wait");
	expect(wait.options.map((option) => option.long)).toEqual([
		"--device",
		"--url",
		"--for",
		"--gone",
		"--stable",
		"--timeout",
		"--interval",
		"--raw",
		"--json",
	]);
	const help = wait.helpInformation().replace(/\s+/g, " ");
	expect(help).toContain("(default: 10000)");
	expect(help).toContain("(default: 500)");
	const watch = command("observe").options.find(
		(option) => option.long === "--watch",
	);
	expect(watch?.parseArg?.("8000", "")).toBe(8000);
	expect(() => watch?.parseArg?.("-1", "")).toThrow(
		"Watch duration must be an integer between 0 and 600000.",
	);
	const samples = command("observe").options.find(
		(option) => option.long === "--samples",
	);
	expect(samples?.parseArg?.("20", "")).toBe(20);
	expect(samples?.parseArg?.("200", "")).toBe(200);
	expect(() => samples?.parseArg?.("601", "")).toThrow(
		"Sample count must be an integer between 1 and 600.",
	);
	const every = command("observe").options.find(
		(option) => option.long === "--every",
	);
	expect(every?.parseArg?.("250", "")).toBe(250);
	expect(() => every?.parseArg?.("10", "")).toThrow(
		"Sample interval must be an integer between 50 and 600000.",
	);
});

test("observe takes a sample count or an interval, never both", async () => {
	await expect(
		command("observe").parseAsync(
			[
				"-d",
				"android:emulator-5554",
				"--watch",
				"10000",
				"--samples",
				"8",
				"--every",
				"250",
			],
			{ from: "user" },
		),
	).rejects.toThrow(/cannot be used with option/);
});

test("target indexes have no arbitrary upper limit", () => {
	for (const name of ["tap", "long-press", "swipe", "type", "fill"]) {
		const option = command(name).options.find((item) => item.long === "--index");
		expect(option?.parseArg?.("1000000", "")).toBe(1_000_000);
		expect(() => option?.parseArg?.("0", "")).toThrow("Index must be a positive integer.");
	}
});

test("touch help explains long presses and swipe direction", () => {
	const longPressHelp = command("long-press")
		.helpInformation()
		.replace(/\s+/g, " ");
	expect(longPressHelp).toContain("Hold duration in milliseconds (default: 600)");

	const swipe = command("swipe");
	let swipeOutput = "";
	swipe.configureOutput({ writeOut: (value) => { swipeOutput += value; } });
	swipe.outputHelp();
	const swipeHelp = swipeOutput.replace(/\s+/g, " ");
	expect(swipeHelp).toContain("Coordinates use x,y.");
	expect(swipeHelp).toContain("Change x for a horizontal swipe.");
	expect(swipeHelp).toContain("Change y for a vertical swipe.");
	expect(swipeHelp).toContain("Content moves in the opposite direction.");
	expect(swipeHelp).toContain(
		"agentsims swipe 80%,50% 20%,50% -d <id>",
	);
});

test("scroll and drag each send one bounded request", async () => {
	const calls: Array<{ command: string; device: string; body: unknown }> = [];
	const lines: string[] = [];
	const action = {
		device: "android:emulator-5554",
		dispatch: { status: "accepted", reason: "Input frames were accepted." },
		verification: { status: "not_applicable", reason: "No value check." },
		resolved: [],
		accessibility: { status: "error", capturedAt: 1, error: "AX unavailable" },
		view: null,
		image: null,
		captureReason: null,
		warnings: [],
	};
	const fake = {
		scrollDevice: async (device: string, request: unknown) => {
			calls.push({ command: "scroll", device, body: request });
			return {
				device,
				direction: "down",
				container: {
					ref: null,
					role: "screen",
					label: "",
					path: null,
					box: { x: 0, y: 0, width: 1080, height: 2400 },
					source: "screen",
				},
				from: { x: 540, y: 1680 },
				to: { x: 540, y: 720 },
				amount: 60,
				durationMs: 900,
				swipes: 1,
				pages: 1,
				endReached: false,
				selector: "cell",
				count: 0,
				items: [],
				action,
			};
		},
		actDevice: async (
			device: string,
			actions: ReadonlyArray<unknown>,
			options: unknown,
		) => {
			calls.push({ command: "act", device, body: { actions, options } });
			return action;
		},
	};
	const root = new Command().exitOverride();
	registerScrollCommands(root, {
		client: () => fake as unknown as ApplicationCommandClient,
		write: (text) => lines.push(text),
	});

	await root.parseAsync(
		[
			"scroll",
			"down",
			"-d",
			"android:emulator-5554",
			"--to-end",
			"--collect",
			"cell",
			"--amount",
			"60",
			"--duration",
			"900",
			"--in",
			"@e14",
		],
		{ from: "user" },
	);
	await root.parseAsync(
		["drag", "@e4", "80%,50%", "-d", "android:emulator-5554", "--capture", "c7"],
		{ from: "user" },
	);

	expect(calls).toEqual([
		{
			command: "scroll",
			device: "android:emulator-5554",
			body: {
				direction: "down",
				in: "@e14",
				amount: 60,
				durationMs: 900,
				toEnd: true,
				collect: "cell",
				maxPages: 30,
			},
		},
		{
			command: "act",
			device: "android:emulator-5554",
			body: {
				actions: [
					{
						type: "swipe",
						from: "@e4",
						to: "80%,50%",
						durationMs: 800,
						capture: "c7",
					},
				],
				options: { screenshot: false },
			},
		},
	]);
	expect(lines[0]).toContain("action  scroll down in screen");
	expect(lines[0]).toContain("pages=1  endReached=no");
});

test("scroll and drag help explains the defaults", () => {
	const scroll = command("scroll");
	let scrollOutput = "";
	scroll.configureOutput({ writeOut: (value) => { scrollOutput += value; } });
	scroll.outputHelp();
	const scrollHelp = scrollOutput.replace(/\s+/g, " ");
	expect(scrollHelp).toContain("Scroll a region one page: down, up, left, right");
	expect(scrollHelp).toContain("Percent of the region to travel (default: 40)");
	expect(scrollHelp).toContain("Swipe duration in milliseconds (default: 600)");
	expect(scrollHelp).toContain("Keep scrolling until the region stops changing");
	expect(scrollHelp).toContain("Page limit for --to-end (default: 30)");
	expect(scrollHelp).toContain(
		"agentsims scroll down --to-end --collect cell -d <id>",
	);

	const dragHelp = command("drag").helpInformation().replace(/\s+/g, " ");
	expect(dragHelp).toContain("Move one finger slowly between two targets");
	expect(dragHelp).toContain("Drag duration in milliseconds (default: 800)");
});

test("permission and button help lists exact platform values", () => {
	const permissions = command("permissions");
	const grant = permissions.commands.find((item) => item.name() === "grant");
	const permissionHelp = grant?.helpInformation().replace(/\s+/g, " ") ?? "";
	expect(permissions.description()).toContain("after the app requests access");
	expect(permissionHelp).toContain("location=always|inuse|never");
	expect(permissionHelp).toContain("photos=limited");
	expect(permissionHelp).toContain("notifications=critical");
	expect(permissionHelp).toContain("Do not use --value for camera.");

	const buttonHelp = command("press").helpInformation().replace(/\s+/g, " ");
	expect(buttonHelp).toContain("Android: home, power, volume-up, volume-down, back, app-switch.");
	expect(buttonHelp).toContain("iOS: home, power, volume-up, volume-down, app-switcher, action, side-button, digital-crown, left-side-button.");
});

test.each([
	["logcat", ["logcat", "-d", "android:emulator-5554"]],
	["button", ["button", "back", "-d", "android:emulator-5554"]],
	["camera webcams", ["camera", "webcams", "-d", "ios-device"]],
	["camera webcam", ["camera", "webcam", "camera-1", "-d", "ios-device"]],
	["observe --no-ax", ["observe", "-d", "ios-device", "--no-ax"]],
	["observe --ax-only", ["observe", "-d", "ios-device", "--ax-only"]],
	["tap --delta", ["tap", "@e1", "-d", "ios-device", "--delta"]],
	["tap --observe", ["tap", "@e1", "-d", "ios-device", "--observe"]],
	["screenshot -o", ["screenshot", "-d", "ios-device", "-o", "x.png"]],
])("rejects removed syntax: %s", async (_name, args) => {
	const errorOutput = spyOn(process.stderr, "write").mockReturnValue(true);
	try {
		const cli = program();
		await expect(cli.parseAsync(args, { from: "user" })).rejects.toBeDefined();
	} finally {
		errorOutput.mockRestore();
	}
});

test.each([
	["camera", "always", "camera does not take --value."],
	["location", "limited", "Invalid --value for location: limited. Use always, inuse, or never."],
	["photos", "always", "Invalid --value for photos: always. Use limited."],
	["notifications", "never", "Invalid --value for notifications: never. Use critical."],
])("rejects invalid %s value before HTTP", async (name, value, message) => {
	await expect(program().parseAsync([
		"permissions", "grant", name, "-d", "ios-device", "-a", "com.example.app",
		"--value", value, "--url", "http://127.0.0.1:1",
	], { from: "user" })).rejects.toThrow(message);
});
