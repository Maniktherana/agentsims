import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
	performAndroidEnvironmentAction,
	parseAndroidEnvironmentState,
	parseAndroidSavedStates,
	readAndroidEnvironmentState,
} from "../../../../../core/android/device/environment-tools";
import type { AndroidToolRunner } from "../../../../../core/android/device/tool-command";

test("emulator-only actions fail on physical devices before a console operation", async () => {
	const commands: readonly string[][] = [];
	const run: AndroidToolRunner = (_serial, args) =>
		Effect.sync(() => {
			(commands as string[][]).push([...args]);
			return "0";
		});
	await expect(
		Effect.runPromise(
			performAndroidEnvironmentAction(
				{ run, resetSession: () => Effect.void },
				"physical-device",
				{ type: "snapshot", operation: "load", name: "saved" },
			),
		),
	).rejects.toThrow("requires an Android emulator");
	expect(commands).toHaveLength(1);
	expect(commands[0]?.[0]).toBe("shell");
});

test("battery unplug clears all charging sources and returns actual readback", async () => {
	const commands: string[] = [];
	const run: AndroidToolRunner = (_serial, args) =>
		Effect.sync(() => {
			commands.push(args.join(" "));
			return args[1] === "'dumpsys' 'battery'" ? "level: 42\nstatus: 3" : "";
		});
	const result = await Effect.runPromise(
		performAndroidEnvironmentAction(
			{ run, resetSession: () => Effect.void },
			"emulator-5554",
			{ type: "battery", charging: false },
		),
	);
	expect(result).toEqual({ state: "level: 42\nstatus: 3" });
	for (const source of ["ac", "wireless", "usb"])
		expect(commands).toContain(
			`shell 'dumpsys' 'battery' 'set' '${source}' '0'`,
		);
	expect(commands.at(-1)).toBe("shell 'dumpsys' 'battery'");
});

test("TalkBack changes preserve other enabled accessibility services", async () => {
	let enabled = "com.example.reader/.ReaderService";
	const calls: string[] = [];
	const run: AndroidToolRunner = (_serial, args) =>
		Effect.sync(() => {
			const command = args.join(" ");
			calls.push(command);
			if (command.includes("query-services"))
				return "com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService";
			if (command.includes("'get' 'secure' 'enabled_accessibility_services'"))
				return enabled;
			if (command.includes("'put' 'secure' 'enabled_accessibility_services'"))
				enabled = command
					.split("'enabled_accessibility_services' '")[1]!
					.slice(0, -1);
			return "";
		});
	await Effect.runPromise(
		performAndroidEnvironmentAction(
			{ run, resetSession: () => Effect.void },
			"emulator-5554",
			{ type: "talkback", enabled: true },
		),
	);
	expect(enabled).toContain("com.example.reader/.ReaderService:");
	await Effect.runPromise(
		performAndroidEnvironmentAction(
			{ run, resetSession: () => Effect.void },
			"emulator-5554",
			{ type: "talkback", enabled: false },
		),
	);
	expect(enabled).toBe("com.example.reader/.ReaderService");
	expect(calls.at(-2)).toBe(
		"shell 'settings' 'put' 'secure' 'accessibility_enabled' '1'",
	);
});

// Console/dumpsys format captured from the running emulator; reads do not mutate it.
const networkStatus = `Current network status:\r
  download speed:          0 bits/s (0.0 KB/s)\r
  upload speed:            0 bits/s (0.0 KB/s)\r
  minimum latency:  0 ms\r
  maximum latency:  0 ms\r
OK\r`;
const batteryStatus = `Current Battery Service state:
  (UPDATES STOPPED -- use 'reset' to restart)
  AC powered: false
  USB powered: false
  Wireless powered: false
  Dock powered: false
  level: 50
  scale: 100`;

test("state parses actual emulator network and battery output without treating zero as unknown", () => {
	expect(
		parseAndroidEnvironmentState({
			wifi: "2\n",
			data: "0",
			airplane: "1",
			network: networkStatus,
			battery: batteryStatus,
			density: "Physical density: 420\nOverride density: 360",
			accessibility: "com.google.android.marvin.talkback/.TalkBackService",
		}),
	).toEqual({
		network: {
			wifi: true,
			data: false,
			airplane: true,
			downloadBps: 0,
			uploadBps: 0,
			minLatencyMs: 0,
			maxLatencyMs: 0,
		},
		battery: { level: 50, charging: false, simulated: true },
		display: { density: 360, talkback: true },
	});
});
test("unknown state stays unknown and battery percentages use the reported scale", () => {
	const empty = parseAndroidEnvironmentState({
		wifi: "null",
		data: "unknown",
		airplane: "",
		network: "",
		battery: "",
		density: "",
		accessibility: "",
	});
	expect(empty.network).toEqual({
		wifi: null,
		data: null,
		airplane: null,
		downloadBps: null,
		uploadBps: null,
		minLatencyMs: null,
		maxLatencyMs: null,
	});
	expect(empty.battery).toEqual({
		level: null,
		charging: null,
		simulated: false,
	});
	expect(empty.display).toEqual({ density: null, talkback: null });
	const physical = parseAndroidEnvironmentState({
		wifi: "1",
		data: "1",
		airplane: "0",
		network: "",
		battery:
			"USB powered: false\nWireless powered: true\nlevel: 75\nscale: 150",
		density: "Physical density: 480",
		accessibility: "null",
	});
	expect(physical.battery).toEqual({
		level: 50,
		charging: true,
		simulated: false,
	});
	expect(physical.display).toEqual({ density: 480, talkback: false });
});
test("saved states skip console headers and preserve the actual snapshot names and dates", () => {
	expect(
		parseAndroidSavedStates(
			"List of snapshots present on all disks:\r\nID        TAG                 VM SIZE                DATE       VM CLOCK\r\n--        agentsims-before-native-restore   331M 2026-09-06 19:57:45  215:14:43.046\r\n--        default_boot           331M 2026-09-06 19:59:05  215:15:56.657\r\nOK\r\n",
		),
	).toEqual([
		{
			name: "agentsims-before-native-restore",
			size: "331M",
			savedAt: "2026-09-06 19:57:45",
		},
		{ name: "default_boot", size: "331M", savedAt: "2026-09-06 19:59:05" },
	]);
	expect(
		parseAndroidSavedStates("List of snapshots present on all disks:\nOK"),
	).toEqual([]);
});
test.each(["emulator-5554", "physical-device"])(
	"state reads stay on %s and physical devices never use the console",
	async (serial) => {
		const calls: readonly string[][] = [];
		const result = await Effect.runPromise(
			readAndroidEnvironmentState((device, args) => {
				expect(device).toBe(serial);
				(calls as string[][]).push([...args]);
				return Effect.succeed(
					args[0] === "emu"
						? networkStatus
						: args[1]?.includes("'battery'")
							? batteryStatus
							: "0",
				);
			}, serial),
		);
		expect(calls.some((args) => args[0] === "emu")).toBe(
			serial.startsWith("emulator-"),
		);
		expect(result.network.downloadBps).toBe(
			serial.startsWith("emulator-") ? 0 : null,
		);
		expect(result.battery.level).toBe(50);
	},
);
