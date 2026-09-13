import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { Effect } from "effect";
import { hostCommandText } from "../host";
import { homedir, tmpdir } from "os";
import { join } from "path";

// ─── Permission catalogue ───

type PermissionKind = "tcc" | "notifications" | "location";

interface PermissionSpec {
	kind: PermissionKind;
	/** TCC service identifier, for `kind === "tcc"`. */
	tccService?: string;
	/** TCC `auth_version` column — photos uses 2, everything else 1. */
	tccAuthVersion?: number;
	/** Whether `--value` is meaningful for this permission. */
	values?: string[];
}

const TCC_SERVICES: Record<string, string> = {
	camera: "kTCCServiceCamera",
	microphone: "kTCCServiceMicrophone",
	photos: "kTCCServicePhotos",
	"photos-add": "kTCCServicePhotosAdd",
	contacts: "kTCCServiceAddressBook",
	calendar: "kTCCServiceCalendar",
	reminders: "kTCCServiceReminders",
	motion: "kTCCServiceMotion",
	"media-library": "kTCCServiceMediaLibrary",
	siri: "kTCCServiceSiri",
	speech: "kTCCServiceSpeechRecognition",
	faceid: "kTCCServiceFaceID",
	"user-tracking": "kTCCServiceUserTracking",
	homekit: "kTCCServiceWillow",
};

export function resolvePermission(name: string): PermissionSpec | null {
	if (name === "notifications")
		return { kind: "notifications", values: ["critical"] };
	if (name === "location")
		return { kind: "location", values: ["always", "inuse", "never"] };
	const service = TCC_SERVICES[name];
	if (service) {
		return {
			kind: "tcc",
			tccService: service,
			tccAuthVersion: name === "photos" ? 2 : 1,
			values: name === "photos" ? ["limited"] : undefined,
		};
	}
	return null;
}

/** Every canonical permission name, used by `reset all` and `--help`. */
export function allPermissionNames(): string[] {
	return ["notifications", "location", ...Object.keys(TCC_SERVICES)];
}

// ─── Simulator paths ───

function simLibraryDir(udid: string): string {
	return join(
		homedir(),
		"Library/Developer/CoreSimulator/Devices",
		udid,
		"data/Library",
	);
}

export function tccDbPath(udid: string): string {
	return join(simLibraryDir(udid), "TCC/TCC.db");
}

export function bulletinDir(udid: string): string {
	return join(simLibraryDir(udid), "BulletinBoard");
}

export function locationdPlistPath(udid: string): string {
	return join(simLibraryDir(udid), "Caches/locationd/clients.plist");
}

// ─── TCC.db writer ───

async function withSqliteRetry(fn: () => Promise<string>): Promise<string> {
	const deadline = Date.now() + 5000;
	for (;;) {
		try {
			return await fn();
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			if (
				Date.now() < deadline &&
				/database is locked|database is busy/i.test(message)
			) {
				await Effect.runPromise(Effect.sleep("200 millis"));
				continue;
			}
			throw error;
		}
	}
}

function sqlite(dbPath: string, sql: string): Promise<string> {
	return withSqliteRetry(() => hostCommandText("sqlite3", dbPath, sql));
}

async function writeTcc(
	udid: string,
	service: string,
	authVersion: number,
	bundleId: string,
	authValue: number | "delete",
): Promise<void> {
	const db = tccDbPath(udid);
	if (!existsSync(db)) {
		throw new Error(
			`TCC.db not found for ${udid}. Is the simulator booted?\n  ${db}`,
		);
	}
	await sqlite(
		db,
		`DELETE FROM access WHERE service='${service}' AND client='${bundleId}' AND client_type=0;`,
	);
	if (authValue !== "delete") {
		await sqlite(
			db,
			`INSERT INTO access (service, client, client_type, auth_value, auth_reason, auth_version, flags) ` +
				`VALUES ('${service}', '${bundleId}', 0, ${authValue}, 2, ${authVersion}, 0);`,
		);
	}
}

// Reverse of TCC_SERVICES, so `list` reports the same permission names that
// grant/revoke/reset accept rather than raw kTCCService* database keys.
const TCC_NAME_BY_SERVICE: Record<string, string> = Object.fromEntries(
	Object.entries(TCC_SERVICES).map(([name, service]) => [service, name]),
);

async function readTcc(
	udid: string,
	bundleId?: string,
): Promise<Record<string, number>> {
	const db = tccDbPath(udid);
	if (!existsSync(db)) return {};
	const where = bundleId ? ` WHERE client='${bundleId}'` : "";
	const out = await sqlite(
		db,
		`SELECT service, auth_value FROM access${where};`,
	);
	const result: Record<string, number> = {};
	for (const line of out.split("\n")) {
		const [service, authValue] = line.split("|");
		if (service)
			result[TCC_NAME_BY_SERVICE[service] ?? service] = Number(authValue);
	}
	return result;
}

// ─── plist helpers ───

function plutil(args: string[]): Promise<string> {
	return hostCommandText("plutil", ...args);
}

async function plistBuddy(
	file: string,
	commands: string[],
	opts: { ignoreErrors?: boolean } = {},
): Promise<string> {
	const args: string[] = [];
	for (const command of commands) args.push("-c", command);
	args.push(file);
	try {
		return await hostCommandText("/usr/libexec/PlistBuddy", ...args);
	} catch (error: unknown) {
		if (opts.ignoreErrors) return "";
		throw error;
	}
}

function makeTmpDir(): string {
	return mkdtempSync(join(tmpdir(), "agentsims-perm-"));
}

// ─── Location writer ───

// locationd owns clients.plist and keys app entries with an `i<bundleId>:`
// scheme — the trailing colon is part of the key, so neither plutil (dot
// paths) nor PlistBuddy (colon paths) can address it, and a hand-written
// plain-bundle-id entry is ignored. `simctl privacy` understands the format
// and is reliable specifically for location, so delegate to it here.
async function setLocation(
	udid: string,
	bundleId: string,
	mode: "grant" | "revoke" | "reset",
	value: string | undefined,
): Promise<void> {
	let action = "grant";
	let service = "location";
	if (mode === "reset") action = "reset";
	else if (mode === "revoke" || value === "never") action = "revoke";
	else if (value === "always") service = "location-always";
	await hostCommandText(
		"xcrun",
		"simctl",
		"privacy",
		udid,
		action,
		service,
		bundleId,
	);
}

async function readLocation(
	udid: string,
	bundleId: string | undefined,
): Promise<{ Authorization: number } | null> {
	if (!bundleId) return null;
	const path = locationdPlistPath(udid);
	if (!existsSync(path)) return null;
	let xml: string;
	try {
		xml = await plutil(["-convert", "xml1", "-o", "-", path]);
	} catch {
		return null;
	}
	const match = xml.match(
		new RegExp(
			`<key>i${bundleId.replace(/[.-]/g, "\\$&")}:</key>\\s*<dict>[\\s\\S]*?` +
				`<key>Authorization</key>\\s*<integer>(\\d+)</integer>`,
		),
	);
	return match ? { Authorization: Number(match[1]) } : null;
}

// ─── Notifications writer ───

// Keyed-archive template for a single app's BulletinBoard section info, lifted
// verbatim from AppleSimulatorUtils (SetNotificationsPermission.m). `$objects`
// indices 2/3/5 are patched per-app: 2 = bundle id, 3 = the settings dict
// (allowsNotifications / criticalAlertSetting), 5 = display name.
const NOTIF_TEMPLATE_B64 =
	"YnBsaXN0MDDUAQIDBAUGTU5YJHZlcnNpb25YJG9iamVjdHNZJGFyY2hpdmVyVCR0b3ASAAGGoKgHCDAxQUgfSVUkbnVsbN8QFQkKCwwNDg8QERITFBUWFxgZGhscHR4fHiEiIx4jJicfHygjIh8jIyMjI18QFHN1cHByZXNzRnJvbVNldHRpbmdzXxASc3VwcHJlc3NlZFNldHRpbmdzWmhpZGVXZWVBcHBZc2VjdGlvbklEW2Rpc3BsYXlOYW1lVGljb25fEBlkaXNwbGF5c0NyaXRpY2FsQnVsbGV0aW5zW3N1YnNlY3Rpb25zXxATc2VjdGlvbkluZm9TZXR0aW5nc1YkY2xhc3NfEA9zZWN0aW9uQ2F0ZWdvcnlfEBJzdWJzZWN0aW9uUHJpb3JpdHlXdmVyc2lvbl8QGm1hbmFnZWRTZWN0aW9uSW5mb1NldHRpbmdzV2FwcE5hbWVbc2VjdGlvblR5cGVfEBBmYWN0b3J5U2VjdGlvbklEXxAPZGF0YVByb3ZpZGVySURzXHN1YnNlY3Rpb25JRFdmaWx0ZXJzXxAYcGF0aFRvV2VlQXBwUGx1Z2luQnVuZGxlCBAACIACgAWAAAiAAIADgAeABoAAgAWAAIAAgACAAIAAXxAmY29tLkxlb05hdGFuLkxOUG9wdXBDb250cm9sbGVyRXhhbXBsZS3ZMjM0NTY3Ejg5Ojs7Ox8fPjtAXHB1c2hTZXR0aW5nc18QGXNob3dzSW5Ob3RpZmljYXRpb25DZW50ZXJfEBNhbGxvd3NOb3RpZmljYXRpb25zXxAWc2hvd3NPbkV4dGVybmFsRGV2aWNlc18QFWNvbnRlbnRQcmV2aWV3U2V0dGluZ15jYXJQbGF5U2V0dGluZ18QEXNob3dzSW5Mb2NrU2NyZWVuWWFsZXJ0VHlwZRA/CQkJgAQJEAHSQkNERVokY2xhc3NuYW1lWCRjbGFzc2VzXxAVQkJTZWN0aW9uSW5mb1NldHRpbmdzokZHXxAVQkJTZWN0aW9uSW5mb1NldHRpbmdzWE5TT2JqZWN0V0xOUG9wdXDSQkNKS11CQlNlY3Rpb25JbmZvokxHXUJCU2VjdGlvbkluZm9fEA9OU0tleWVkQXJjaGl2ZXLRT1BUcm9vdIABAAgAEQAaACMALQAyADcAQABGAHMAigCfAKoAtADAAMUA4QDtAQMBCgEcATEBOQFWAV4BagF9AY8BnAGkAb8BwAHCAcMBxQHHAckBygHMAc4B0AHSAdQB1gHYAdoB3AHeAeACCQIcAikCRQJbAnQCjAKbAq8CuQK7ArwCvQK+AsACwQLDAsgC0wLcAvQC9wMPAxgDIAMlAzMDNgNEA1YDWQNeAAAAAAAAAgEAAAAAAAAAUQAAAAAAAAAAAAAAAAAAA2A=";

function bulletinPlistPath(udid: string): string {
	return join(bulletinDir(udid), "VersionedSectionInfo.plist");
}

/**
 * Write the per-app section-info keyed archive to a temp file and return its
 * path. The result is a binary plist suitable for `Import`ing as a `<data>`
 * value into the destination BulletinBoard plist.
 */
async function buildSectionInfoBlob(
	dir: string,
	bundleId: string,
	enabled: boolean,
	critical: boolean,
): Promise<string> {
	const blob = join(dir, "section-info.plist");
	writeFileSync(blob, Buffer.from(NOTIF_TEMPLATE_B64, "base64"));
	await plistBuddy(blob, [
		`Set :$objects:2 ${bundleId}`,
		`Set :$objects:3:allowsNotifications ${enabled ? "true" : "false"}`,
		`Add :$objects:3:criticalAlertSetting integer ${critical ? 2 : 0}`,
		`Set :$objects:5 ${bundleId}`,
		"Save",
	]);
	await plutil(["-convert", "binary1", blob]);
	return blob;
}

async function setNotifications(
	udid: string,
	bundleId: string,
	mode: "grant" | "critical" | "revoke" | "reset",
): Promise<void> {
	const path = bulletinPlistPath(udid);
	if (!existsSync(path)) {
		if (mode === "reset") return;
		const deadline = Date.now() + 5000;
		while (!existsSync(path) && Date.now() < deadline) {
			await Effect.runPromise(Effect.sleep("250 millis"));
		}
		if (!existsSync(path)) {
			throw new Error(`BulletinBoard plist not found for ${udid}.\n  ${path}`);
		}
	}
	try {
		await hostCommandText("chflags", "nouchg", path);
	} catch (error) {
		console.warn("[agentsims:ios] recoverable operation failed", error);
	}
	const tmp = makeTmpDir();
	try {
		await plistBuddy(path, [`Delete :sectionInfo:${bundleId}`, "Save"], {
			ignoreErrors: true,
		});
		if (mode !== "reset") {
			const blob = await buildSectionInfoBlob(
				tmp,
				bundleId,
				mode !== "revoke",
				mode === "critical",
			);
			await plistBuddy(path, [
				`Import :sectionInfo:${bundleId} ${blob}`,
				"Save",
			]);
		}
		await plutil(["-convert", "binary1", path]);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
		try {
			chmodSync(path, 0o644);
			await hostCommandText("chflags", "uchg", path);
		} catch (error) {
			console.warn("[agentsims:ios] recoverable operation failed", error);
		}
	}
}

async function readNotifications(
	udid: string,
	bundleId: string | undefined,
): Promise<{ allowsNotifications: boolean; critical: boolean } | null> {
	if (!bundleId) return null;
	const path = bulletinPlistPath(udid);
	if (!existsSync(path)) return null;
	try {
		const sectionInfo = await plutil([
			"-extract",
			"sectionInfo",
			"xml1",
			"-o",
			"-",
			path,
		]);
		const match = sectionInfo.match(
			new RegExp(
				`<key>${bundleId.replace(/[.-]/g, "\\$&")}</key>\\s*<data>([\\s\\S]*?)</data>`,
			),
		);
		if (!match?.[1]) return null;
		const tmp = makeTmpDir();
		try {
			const blob = join(tmp, "section-info.plist");
			writeFileSync(blob, Buffer.from(match[1].replace(/\s/g, ""), "base64"));
			const inner = await plutil(["-convert", "xml1", "-o", "-", blob]);
			return {
				allowsNotifications: /<key>allowsNotifications<\/key>\s*<true\/>/.test(
					inner,
				),
				critical:
					/<key>criticalAlertSetting<\/key>\s*<integer>2<\/integer>/.test(
						inner,
					),
			};
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	} catch {
		return null;
	}
}

// ─── Dispatch ───

type PermissionMutation = "grant" | "revoke" | "reset";

async function applyOne(
	udid: string,
	verb: PermissionMutation,
	permission: string,
	value: string | undefined,
	bundleId: string,
): Promise<void> {
	const spec = resolvePermission(permission)!;
	if (spec.kind === "tcc") {
		const authValue: number | "delete" =
			verb === "reset"
				? "delete"
				: verb === "revoke"
					? 0
					: value === "limited"
						? 3
						: 2;
		await writeTcc(
			udid,
			spec.tccService!,
			spec.tccAuthVersion!,
			bundleId,
			authValue,
		);
	} else if (spec.kind === "notifications") {
		const mode =
			verb === "reset"
				? "reset"
				: verb === "revoke"
					? "revoke"
					: value === "critical"
						? "critical"
						: "grant";
		await setNotifications(udid, bundleId, mode);
	} else {
		await setLocation(udid, bundleId, verb, value);
	}
}

export async function resetAllPermissions(udid: string, bundleId: string) {
	for (const name of allPermissionNames()) {
		await applyOne(udid, "reset", name, undefined, bundleId);
	}
}

export async function setPermission(
	udid: string,
	verb: PermissionMutation,
	permission: string,
	bundleId: string,
	value?: string,
): Promise<void> {
	const spec = resolvePermission(permission);
	if (!spec) throw new Error(`Unknown permission: ${permission}`);
	if (value !== undefined && !spec.values?.includes(value)) {
		throw new Error(`Invalid value for ${permission}: ${value}`);
	}
	await applyOne(udid, verb, permission, value, bundleId);
}

export async function listPermissions(udid: string, bundleId?: string) {
	const [tcc, location, notifications] = await Promise.all([
		readTcc(udid, bundleId),
		readLocation(udid, bundleId),
		readNotifications(udid, bundleId),
	]);
	return { udid, bundleId: bundleId ?? null, tcc, location, notifications };
}
