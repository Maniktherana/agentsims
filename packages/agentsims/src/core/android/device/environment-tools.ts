import { Effect } from "effect";
import type {
	AndroidEnvironmentState,
	AndroidSavedState,
	AndroidToolAction,
} from "../contracts";
import { androidShell, type AndroidToolRunner } from "./tool-command";
import {
	CommandUnavailable,
	CommandFailure,
	type ApplicationCommandError,
} from "../../tools/errors";

type EnvironmentAction = Exclude<
	AndroidToolAction,
	{ type: "apps" | "app" | "install" | "link" }
>;
type Dependencies = {
	run: AndroidToolRunner;
	resetSession(serial: string): Effect.Effect<void, ApplicationCommandError>;
};

export function parseAndroidSavedStates(output: string): AndroidSavedState[] {
	return output.split(/\r?\n/).flatMap((line) => {
		const match = line.match(
			/^\s*(?:--|\d+)\s+([A-Za-z0-9._-]+)\s+(\S+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})/,
		);
		return match
			? [{ name: match[1]!, size: match[2]!, savedAt: match[3]! }]
			: [];
	});
}

export function parseAndroidEnvironmentState(values: {
	wifi: string;
	data: string;
	airplane: string;
	network: string;
	battery: string;
	density: string;
	accessibility: string;
}): AndroidEnvironmentState {
	const enabled = (value: string) =>
		/^(?:1|2)$/.test(value.trim()) ? true : value.trim() === "0" ? false : null;
	const number = (text: string, pattern: RegExp) => {
		const match = text.match(pattern);
		return match ? Number(match[1]) : null;
	};
	const charging = [
		...values.battery.matchAll(
			/(?:AC|USB|Wireless|Dock) powered:\s*(true|false)/g,
		),
	];
	const level = number(values.battery, /^\s*level:\s*(\d+)/m);
	const scale = number(values.battery, /^\s*scale:\s*(\d+)/m);
	return {
		network: {
			wifi: enabled(values.wifi),
			data: enabled(values.data),
			airplane: enabled(values.airplane),
			downloadBps: number(values.network, /download speed:\s*(\d+)\s*bits\/s/),
			uploadBps: number(values.network, /upload speed:\s*(\d+)\s*bits\/s/),
			minLatencyMs: number(values.network, /minimum latency:\s*(\d+)\s*ms/),
			maxLatencyMs: number(values.network, /maximum latency:\s*(\d+)\s*ms/),
		},
		battery: {
			level: level === null ? null : Math.round((level / (scale || 100)) * 100),
			charging: charging.length
				? charging.some((match) => match[1] === "true")
				: null,
			simulated: values.battery.includes("UPDATES STOPPED"),
		},
		display: {
			density:
				number(values.density, /Override density:\s*(\d+)/) ??
				number(values.density, /Physical density:\s*(\d+)/),
			talkback:
				values.accessibility.trim() === ""
					? null
					: /talkback/i.test(values.accessibility),
		},
	};
}

export function readAndroidEnvironmentState(
	run: AndroidToolRunner,
	serial: string,
) {
	const shell = (...args: string[]) => androidShell(run, serial, ...args);
	return Effect.gen(function* () {
		const emulator =
			/^emulator-\d+$/.test(serial) ||
			(yield* shell("getprop", "ro.kernel.qemu")) === "1";
		const values = yield* Effect.all(
			{
				wifi: shell("settings", "get", "global", "wifi_on"),
				data: shell("settings", "get", "global", "mobile_data"),
				airplane: shell("settings", "get", "global", "airplane_mode_on"),
				network: emulator
					? run(serial, ["emu", "network", "status"])
					: Effect.succeed(""),
				battery: shell("dumpsys", "battery"),
				density: shell("wm", "density"),
				accessibility: shell(
					"settings",
					"get",
					"secure",
					"enabled_accessibility_services",
				),
			},
			{ concurrency: 4 },
		);
		return parseAndroidEnvironmentState(values);
	});
}
export function requireAndroidEmulator(run: AndroidToolRunner, serial: string) {
	return androidShell(run, serial, "getprop", "ro.kernel.qemu").pipe(
		Effect.flatMap((value) =>
			value === "1" || /^emulator-\d+$/.test(serial)
				? Effect.void
				: Effect.fail(
						new CommandUnavailable({
							message: "This control requires an Android emulator",
						}),
					),
		),
	);
}
export function androidTalkbackServices(
	run: AndroidToolRunner,
	serial: string,
) {
	return androidShell(
		run,
		serial,
		"cmd",
		"package",
		"query-services",
		"--brief",
		"-a",
		"android.accessibilityservice.AccessibilityService",
	).pipe(
		Effect.map((value) =>
			value
				.split(/\r?\n/)
				.map((line) => line.trim())
				.filter(
					(line) =>
						/^[A-Za-z0-9_.]+\/[A-Za-z0-9_.]+$/.test(line) &&
						/talkback/i.test(line),
				),
		),
	);
}
function requireAndroidFeature(
	run: AndroidToolRunner,
	serial: string,
	feature: string,
) {
	return androidShell(run, serial, "pm", "list", "features").pipe(
		Effect.flatMap((value) =>
			value
				.split(/\r?\n/)
				.some(
					(line) =>
						line === `feature:${feature}` ||
						line.startsWith(`feature:${feature}=`),
				)
				? Effect.void
				: Effect.fail(
						new CommandUnavailable({
							message: `This Android device does not support ${feature.replace("android.hardware.", "")}`,
						}),
					),
		),
	);
}
export function performAndroidEnvironmentAction(
	dependencies: Dependencies,
	serial: string,
	action: EnvironmentAction,
): Effect.Effect<unknown, ApplicationCommandError> {
	const shell = (...args: string[]) =>
		androidShell(dependencies.run, serial, ...args);
	const emu = (...args: string[]) =>
		dependencies.run(serial, ["emu", ...args], 180000);
	return Effect.gen(function* () {
		switch (action.type) {
			case "network": {
				if (action.speed || action.delay) {
					yield* requireAndroidEmulator(dependencies.run, serial);
					if (action.speed) yield* emu("network", "speed", action.speed);
					if (action.delay) yield* emu("network", "delay", action.delay);
				}
				if (action.wifi !== undefined)
					yield* shell("svc", "wifi", action.wifi ? "enable" : "disable");
				if (action.data !== undefined)
					yield* shell("svc", "data", action.data ? "enable" : "disable");
				if (action.airplane !== undefined)
					yield* shell(
						"cmd",
						"connectivity",
						"airplane-mode",
						action.airplane ? "enable" : "disable",
					);
				return {
					wifi: yield* shell("settings", "get", "global", "wifi_on"),
					data: yield* shell("settings", "get", "global", "mobile_data"),
					airplane: yield* shell(
						"settings",
						"get",
						"global",
						"airplane_mode_on",
					),
					...(action.speed || action.delay
						? { conditions: yield* emu("network", "status") }
						: {}),
				};
			}
			case "battery": {
				if (action.reset) yield* shell("dumpsys", "battery", "reset");
				else {
					if (action.level !== undefined)
						yield* shell(
							"dumpsys",
							"battery",
							"set",
							"level",
							String(action.level),
						);
					if (action.charging !== undefined) {
						yield* shell("dumpsys", "battery", "set", "ac", "0");
						yield* shell("dumpsys", "battery", "set", "wireless", "0");
						yield* shell(
							"dumpsys",
							"battery",
							"set",
							"usb",
							action.charging ? "1" : "0",
						);
						yield* shell(
							"dumpsys",
							"battery",
							"set",
							"status",
							action.charging ? "2" : "3",
						);
					}
				}
				return { state: yield* shell("dumpsys", "battery") };
			}
			case "snapshot": {
				yield* requireAndroidEmulator(dependencies.run, serial);
				if (action.operation === "load")
					yield* dependencies.resetSession(serial);
				const output = yield* emu(
					"avd",
					"snapshot",
					action.operation,
					...(action.name ? [action.name] : []),
				);
				if (action.operation === "load") {
					yield* dependencies.run(serial, ["wait-for-device"], 60000);
					yield* Effect.gen(function* () {
						while ((yield* shell("getprop", "sys.boot_completed")) !== "1")
							yield* Effect.sleep("500 millis");
					}).pipe(
						Effect.timeoutFail({
							duration: "60 seconds",
							onTimeout: () =>
								new CommandFailure({
									message: "Snapshot loaded, but Android did not become ready",
								}),
						}),
					);
					yield* dependencies.resetSession(serial);
				}
				return {
					output,
					...(action.operation === "list"
						? { snapshots: parseAndroidSavedStates(output) }
						: {}),
				};
			}
			case "call":
				yield* requireAndroidEmulator(dependencies.run, serial);
				yield* requireAndroidFeature(
					dependencies.run,
					serial,
					"android.hardware.telephony",
				);
				return { output: yield* emu("gsm", action.operation, action.number) };
			case "sms":
				yield* requireAndroidEmulator(dependencies.run, serial);
				yield* requireAndroidFeature(
					dependencies.run,
					serial,
					"android.hardware.telephony",
				);
				return {
					output: yield* emu("sms", "send", action.number, action.text),
				};
			case "density":
				yield* shell("wm", "density", String(action.dpi));
				return { state: yield* shell("wm", "density") };
			case "locale": {
				if (Number(yield* shell("getprop", "ro.build.version.sdk")) < 33)
					return yield* Effect.fail(
						new CommandUnavailable({
							message: "Per-app locale requires Android 13 or later",
						}),
					);
				yield* shell(
					"cmd",
					"locale",
					"set-app-locales",
					action.package,
					"--locales",
					action.locale,
				);
				return {
					state: yield* shell(
						"cmd",
						"locale",
						"get-app-locales",
						action.package,
					),
				};
			}
			case "talkback": {
				const components = yield* androidTalkbackServices(
					dependencies.run,
					serial,
				);
				if (!components.length)
					return yield* Effect.fail(
						new CommandUnavailable({
							message: "TalkBack is not installed on this device",
						}),
					);
				const current = yield* shell(
					"settings",
					"get",
					"secure",
					"enabled_accessibility_services",
				);
				const enabled = new Set(current === "null" ? [] : current.split(":"));
				if (action.enabled) enabled.add(components[0]!);
				else for (const component of components) enabled.delete(component);
				yield* shell(
					"settings",
					"put",
					"secure",
					"enabled_accessibility_services",
					[...enabled].filter(Boolean).join(":"),
				);
				yield* shell(
					"settings",
					"put",
					"secure",
					"accessibility_enabled",
					enabled.size ? "1" : "0",
				);
				return {
					services: yield* shell(
						"settings",
						"get",
						"secure",
						"enabled_accessibility_services",
					),
				};
			}
			case "location":
				yield* requireAndroidEmulator(dependencies.run, serial);
				return {
					output: yield* emu(
						"geo",
						"fix",
						String(action.longitude),
						String(action.latitude),
						String(action.altitude ?? 0),
					),
				};
			case "settings": {
				if (action.theme)
					yield* shell(
						"cmd",
						"uimode",
						"night",
						action.theme === "dark"
							? "yes"
							: action.theme === "light"
								? "no"
								: "auto",
					);
				if (action.fontScale !== undefined)
					yield* shell(
						"settings",
						"put",
						"system",
						"font_scale",
						String(action.fontScale),
					);
				if (action.reducedMotion !== undefined)
					for (const key of [
						"window_animation_scale",
						"transition_animation_scale",
						"animator_duration_scale",
					])
						yield* shell(
							"settings",
							"put",
							"global",
							key,
							action.reducedMotion ? "0" : "1",
						);
				if (action.showTouches !== undefined)
					yield* shell(
						"settings",
						"put",
						"system",
						"show_touches",
						action.showTouches ? "1" : "0",
					);
				if (action.pointerLocation !== undefined)
					yield* shell(
						"settings",
						"put",
						"system",
						"pointer_location",
						action.pointerLocation ? "1" : "0",
					);
				return {
					theme: yield* shell("cmd", "uimode", "night"),
					fontScale: yield* shell("settings", "get", "system", "font_scale"),
					animationScale: yield* shell(
						"settings",
						"get",
						"global",
						"animator_duration_scale",
					),
					showTouches: yield* shell(
						"settings",
						"get",
						"system",
						"show_touches",
					),
					pointerLocation: yield* shell(
						"settings",
						"get",
						"system",
						"pointer_location",
					),
				};
			}
		}
	});
}
