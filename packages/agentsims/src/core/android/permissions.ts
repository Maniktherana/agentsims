import { adbText } from "./device/adb";

const PERMISSION_PREFIX = "android.permission.";
const BARE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const QUALIFIED_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const ENTRY =
	/^\s*([A-Za-z][A-Za-z0-9_.]*): granted=(true|false)(?:, flags=\[(.*)\])?/;

export interface AndroidPermissionState {
	permission: string;
	granted: boolean;
	flags: string[];
}

export interface AndroidPermissionReset {
	revoked: string[];
	skipped: { permission: string; reason: string }[];
}

/**
 * Accepts `CAMERA`, `camera`, or `android.permission.CAMERA`. A name already
 * qualified with another namespace, such as a vendor permission, is kept as
 * written.
 */
export function normalizeAndroidPermission(name: string): string | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	if (BARE_NAME.test(trimmed))
		return `${PERMISSION_PREFIX}${trimmed.toUpperCase()}`;
	if (!QUALIFIED_NAME.test(trimmed)) return null;
	if (!trimmed.startsWith(PERMISSION_PREFIX)) return trimmed;
	const bare = trimmed.slice(PERMISSION_PREFIX.length);
	return BARE_NAME.test(bare) ? `${PERMISSION_PREFIX}${bare.toUpperCase()}` : null;
}

/**
 * Reads the first `runtime permissions:` block of `dumpsys package`. An updated
 * system app is listed twice, under `Packages:` and under
 * `Hidden system packages:`. The first block is the active one.
 */
export function parseRuntimePermissions(dump: string): AndroidPermissionState[] {
	const start = dump.indexOf("runtime permissions:");
	if (start === -1) return [];
	const states: AndroidPermissionState[] = [];
	for (const line of dump.slice(start).split("\n").slice(1)) {
		const entry = ENTRY.exec(line);
		if (!entry) break;
		states.push({
			permission: entry[1]!,
			granted: entry[2] === "true",
			flags: (entry[3] ?? "")
				.split("|")
				.map((flag) => flag.trim())
				.filter(Boolean),
		});
	}
	return states;
}

async function run(serial: string, command: string[]): Promise<void> {
	const output = (
		await adbText(["-s", serial, "shell", ...command], 10_000)
	).trim();
	if (output) throw new Error(output);
}

async function dumpPackage(serial: string, packageName: string): Promise<string> {
	const dump = await adbText(
		["-s", serial, "shell", "dumpsys", "package", packageName],
		15_000,
	);
	if (!dump.includes(`Package [${packageName}]`))
		throw new Error(`App is not installed: ${packageName}`);
	return dump;
}

export async function listAndroidPermissions(
	serial: string,
	packageName: string,
): Promise<{
	device: string;
	packageName: string;
	runtime: AndroidPermissionState[];
}> {
	return {
		device: serial,
		packageName,
		runtime: parseRuntimePermissions(await dumpPackage(serial, packageName)),
	};
}

/**
 * `pm grant` and `pm revoke` exit 0 and print nothing when the app does not
 * declare the permission, so the resulting state decides the outcome.
 */
export async function setAndroidPermission(
	serial: string,
	verb: "grant" | "revoke",
	permission: string,
	packageName: string,
): Promise<void> {
	const name = normalizeAndroidPermission(permission);
	if (!name) throw new Error(`Unknown permission: ${permission}`);
	const declared = parseRuntimePermissions(
		await dumpPackage(serial, packageName),
	);
	if (!declared.some((state) => state.permission === name))
		throw new Error(
			`${packageName} does not declare ${name} as a runtime permission.`,
		);
	await run(serial, ["pm", verb, packageName, name]);
	const after = parseRuntimePermissions(
		await dumpPackage(serial, packageName),
	).find((state) => state.permission === name);
	const expected = verb === "grant";
	if (after?.granted !== expected)
		throw new Error(
			`${verb} did not change ${name}. The permission is fixed by the system or by policy.`,
		);
}

/**
 * Returns one permission to its default state. `pm revoke` denies it, and
 * clearing the user flags removes the "do not ask again" state, so the app
 * prompts again on its next request.
 */
export async function resetAndroidPermission(
	serial: string,
	permission: string,
	packageName: string,
): Promise<void> {
	const name = normalizeAndroidPermission(permission);
	if (!name) throw new Error(`Unknown permission: ${permission}`);
	const declared = parseRuntimePermissions(
		await dumpPackage(serial, packageName),
	);
	if (!declared.some((state) => state.permission === name))
		throw new Error(
			`${packageName} does not declare ${name} as a runtime permission.`,
		);
	await run(serial, ["pm", "revoke", packageName, name]);
	await run(serial, [
		"pm",
		"clear-permission-flags",
		packageName,
		name,
		"user-set",
		"user-fixed",
	]);
}

/**
 * Returns the whole app to its default state. `pm reset-permissions` covers the
 * whole device, so one app is reset through its own app-ops modes and each of
 * its runtime permissions.
 */
export async function resetAndroidPermissions(
	serial: string,
	packageName: string,
): Promise<AndroidPermissionReset> {
	const runtime = parseRuntimePermissions(
		await dumpPackage(serial, packageName),
	);
	await adbText(["-s", serial, "shell", "appops", "reset", packageName], 10_000);
	const revoked: string[] = [];
	const skipped: { permission: string; reason: string }[] = [];
	for (const state of runtime) {
		try {
			await resetAndroidPermission(serial, state.permission, packageName);
			if (state.granted) revoked.push(state.permission);
		} catch (error) {
			skipped.push({
				permission: state.permission,
				reason: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { revoked, skipped };
}
