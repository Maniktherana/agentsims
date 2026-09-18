import { expect, spyOn, test } from "bun:test";
import type { Command } from "commander";
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
		"type",
		"fill",
		"press",
		"rotate",
		"run",
		"observe",
		"screenshot",
		"wait",
		"find",
		"camera",
		"app",
		"permissions",
		"doctor",
	]);
	expect(command("device-logs").aliases()).toEqual([]);
	expect(command("camera").commands.find((item) => item.name() === "list")?.aliases()).toEqual([]);
	expect(command("camera").commands.find((item) => item.name() === "use")?.aliases()).toEqual([]);
});

test("action and app help shows the supported options", () => {
	const expected: Record<string, string[]> = {
		tap: ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index"],
		"long-press": ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", "--duration"],
		swipe: ["--device", "--url", "--json", "--screenshot", "--capture", "--role", "--index", "--duration"],
		type: ["--device", "--url", "--json", "--screenshot", "--into", "--capture", "--role", "--index", "--submit"],
		fill: ["--device", "--url", "--json", "--screenshot", "--into", "--capture", "--role", "--index", "--submit"],
		press: ["--device", "--url", "--json", "--screenshot"],
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
	for (const name of ["launch", "stop"])
		expect(app.commands.find((item) => item.name() === name)?.options.map((option) => option.long)).toEqual([
			"--device",
			"--url",
			"--json",
			"--screenshot",
		]);
});

test("timed observation help lists the sampling and waiting options", () => {
	const observe = command("observe").options.map((option) => option.long);
	expect(observe).toContain("--watch");
	expect(observe).toContain("--samples");
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
		"Watch duration must be an integer between 0 and 120000.",
	);
	const samples = command("observe").options.find(
		(option) => option.long === "--samples",
	);
	expect(samples?.parseArg?.("8", "")).toBe(8);
	expect(() => samples?.parseArg?.("17", "")).toThrow(
		"Frame count must be an integer between 1 and 16.",
	);
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
		"agentsims swipe 80%,50% 20%,50% --capture c7 -d <id>",
	);
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
