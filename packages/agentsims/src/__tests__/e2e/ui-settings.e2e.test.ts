import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { getUiOption, getUiStatus, setUiOption } from "../../core/ios/settings";
import { explicitIosDevice } from "../helpers/native-e2e";
import {
	acquireIosSimulatorTestLock,
	IOS_E2E_HOOK_TIMEOUT_MS,
} from "../helpers/ios-e2e-lock";

const device = explicitIosDevice;
const describeConfigured = device ? describe : describe.skip;
const EXEC_TIMEOUT_MS = 15_000;

type TerminationResult = {
	status: number | null;
	stderr: string;
	signal: string | null;
	cause?: unknown;
};

function terminationFailure(result: TerminationResult): Error | null {
	if (result.status === 0) return null;
	if (
		result.status === 3 &&
		/found nothing to terminate/i.test(result.stderr)
	)
		return null;
	const details = [
		`status=${result.status ?? "none"}`,
		...(result.signal ? [`signal=${result.signal}`] : []),
		...(result.stderr.trim() ? [`stderr=${result.stderr.trim()}`] : []),
	];
	return new Error(`Failed to terminate Settings (${details.join(", ")}).`, {
		cause: result.cause,
	});
}

function terminateSettings(device: string): void {
	try {
		execFileSync(
			"xcrun",
			["simctl", "terminate", device, "com.apple.Preferences"],
			{
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: EXEC_TIMEOUT_MS,
			},
		);
	} catch (cause) {
		const commandError = cause as {
			status?: number | null;
			stderr?: string | Buffer;
			signal?: string | null;
		};
		const failure = terminationFailure({
			status: commandError.status ?? null,
			stderr:
				typeof commandError.stderr === "string"
					? commandError.stderr
					: (commandError.stderr?.toString("utf-8") ?? ""),
			signal: commandError.signal ?? null,
			cause,
		});
		if (failure) throw failure;
	}
}

test.each([
	["success", { status: 0, stderr: "", signal: null }, null],
	[
		"known already-stopped status",
		{
			status: 3,
			stderr: "Application termination failed: found nothing to terminate",
			signal: null,
		},
		null,
	],
	[
		"status 3 with an unrelated diagnostic",
		{ status: 3, stderr: "Simulator service is unavailable", signal: null },
		"status=3",
	],
	[
		"another nonzero status",
		{ status: 1, stderr: "Operation denied", signal: null },
		"status=1",
	],
	[
		"a timeout or signal failure",
		{ status: null, stderr: "", signal: "SIGTERM" },
		"signal=SIGTERM",
	],
] as const)("classifies Settings termination: %s", (_name, result, expected) => {
	const failure = terminationFailure(result);
	if (expected === null) expect(failure).toBeNull();
	else expect(failure?.message).toContain(expected);
});

function simDefault(domain: string, key: string): string {
	try {
		return execFileSync(
			"xcrun",
			["simctl", "spawn", device!, "defaults", "read", domain, key],
			{
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: EXEC_TIMEOUT_MS,
			},
		).trim();
	} catch {
		return "<missing>";
	}
}

describeConfigured("iOS simulator settings", () => {
	let initial: Record<string, string> = {};
	let releaseLock = () => {};

	beforeAll(async () => {
		releaseLock = await acquireIosSimulatorTestLock(device!);
		initial = await getUiStatus(device!);
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	afterAll(async () => {
		const failures: unknown[] = [];
		try {
			try {
				for (const [option, value] of Object.entries(initial)) {
					if (value !== "unsupported")
						await setUiOption(device!, option, value);
				}
			} catch (error) {
				failures.push(error);
			}
			try {
				terminateSettings(device!);
			} catch (error) {
				failures.push(error);
			}
		} finally {
			try {
				releaseLock();
			} catch (error) {
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(
				failures,
				"Settings restoration or cleanup failed.",
			);
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	test.each([
		["appearance", "dark", "dark"],
		["liquid-glass", "tinted", "tinted"],
		["text-size", "accessibility-medium", "accessibility-medium"],
		["increase-contrast", "on", "on"],
	] as const)("sets and reads %s", async (option, value, expected) => {
		await setUiOption(device!, option, value);
		expect(await getUiOption(device!, option)).toBe(expected);
	});

	test("color filters update the native preference", async () => {
		await setUiOption(device!, "color-filter", "red-green");
		expect(
			simDefault(
				"com.apple.mediaaccessibility",
				"__Color__.MADisplayFilterCategoryEnabled",
			),
		).toBe("1");
		expect(await getUiOption(device!, "color-filter")).toBe("red-green");
	});

	test.each([
		["reduce-motion", "ReduceMotionEnabled"],
		["show-borders", "ButtonShapesEnabled"],
		["reduce-transparency", "EnhancedBackgroundContrastEnabled"],
		["voiceover", "VoiceOverTouchEnabled"],
	] as const)(
		"%s updates the accessibility preference",
		async (option, key) => {
			await setUiOption(device!, option, "on");
			expect(simDefault("com.apple.Accessibility", key)).toBe("1");
			expect(await getUiOption(device!, option)).toBe("on");
		},
	);

	test("status reports every supported option", async () => {
		expect(Object.keys(await getUiStatus(device!)).sort()).toEqual([
			"appearance",
			"color-filter",
			"increase-contrast",
			"liquid-glass",
			"reduce-motion",
			"reduce-transparency",
			"show-borders",
			"text-size",
			"voiceover",
		]);
	});
});
