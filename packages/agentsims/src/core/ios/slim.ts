/**
 * Slim iOS Simulator boots: keep background daemons that a test device does not
 * need from starting. launchd_sim reads per-device disable overrides from a host
 * file when the device boots. Labels written there while the device is Shutdown
 * never start. The overrides persist across boots and `simctl erase`.
 *
 * The label list comes from simslim (MIT, Copyright 2026 Interlap). See
 * THIRD_PARTY_NOTICES.md. Labels that a kept category also needs are left out.
 */
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentsimsHome } from "../home";
import { logRuntime } from "../logging";

export const SLIM_CATEGORIES = [
	{
		// Home and Lock Screen widgets, wallpaper posters, and Live Activities stop updating.
		id: "widgets",
		labels: ["com.apple.PosterBoard", "com.apple.chronod", "com.apple.liveactivitiesd"],
	},
	{
		// Siri, speech, and Apple Intelligence are unavailable.
		id: "siri",
		labels: [
			"com.apple.assistant_cdmd",
			"com.apple.assistant_service",
			"com.apple.siriactionsd",
			"com.apple.siriinferenced",
			"com.apple.siriknowledged",
			"com.apple.sirittsd",
			"com.apple.siri.context.service",
			"com.apple.siri.acousticsignature",
			"com.apple.corespeechd",
			"com.apple.voiced",
			"com.apple.voicebankingd",
			"com.apple.speechmodeltrainingd",
			"com.apple.intelligenceplatformd",
			"com.apple.intelligencecontextd",
			"com.apple.intelligenceflowd",
			"com.apple.intelligencetasksd",
			"com.apple.generativeexperiencesd",
			"com.apple.knowledgeconstructiond",
			"com.apple.naturallanguaged",
			"com.apple.textunderstandingd",
			"com.apple.modelcatalogd",
			"com.apple.modelmanagerd",
			"com.apple.mlhostd",
			"com.apple.mlruntimed",
			"com.apple.suggestd",
			"com.apple.parsecd",
			"com.apple.parsec-fbf",
			"com.apple.proactiveeventtrackerd",
		],
	},
	{
		// Spotlight and Settings search return no results; Files Recents does not load.
		id: "search",
		labels: [
			"com.apple.searchd",
			"com.apple.searchtoold",
			"com.apple.spotlightknowledged",
			"com.apple.spotlightknowledged.updater",
			"com.apple.corespotlightservice",
		],
	},
	{
		// iCloud sync, Apple Account, Keychain sync, and backup do not work.
		id: "icloud",
		labels: [
			"com.apple.appleaccountd",
			"com.apple.appleaccounttransparencyd",
			"com.apple.appleidsetupd",
			"com.apple.akd",
			"com.apple.cloudd",
			"com.apple.cloudphotod",
			"com.apple.ckdiscretionaryd",
			"com.apple.cloudsettingssyncagent",
			"com.apple.bird",
			"com.apple.syncdefaultsd",
			"com.apple.cdpd",
			"com.apple.sosd",
			"com.apple.SecureBackupDaemon",
			"com.apple.TrustedPeersHelper",
			"com.apple.protectedcloudstorage.protectedcloudkeysyncing",
			"com.apple.icloudmailagent",
			"com.apple.icloudsubscriptionoptimizerd",
			"com.apple.communicationtrustd",
		],
	},
	{
		// Family Sharing, Screen Time, and usage tracking stop working.
		id: "family",
		labels: [
			"com.apple.familycircled",
			"com.apple.FamilyControlsAgent",
			"com.apple.familynotification",
			"com.apple.askpermissiond",
			"com.apple.asktod",
			"com.apple.ScreenTimeAgent",
			"com.apple.ScreenTimeSettingsAgent",
			"com.apple.UsageTrackingAgent",
		],
	},
	{
		// HealthKit, HomeKit, and Fitness integrations do not work.
		id: "health",
		labels: [
			"com.apple.healthd",
			"com.apple.healthappd",
			"com.apple.healthcontentd",
			"com.apple.healtheventsd",
			"com.apple.healthrecordsd",
			"com.apple.finhealthd",
			"com.apple.homed",
			"com.apple.homeeventsd",
			"com.apple.fitcore",
			"com.apple.fitcore.session",
			"com.apple.fitnesscoachingd",
			"com.apple.fitnessintelligenced",
			"com.apple.activityawardsd",
			"com.apple.activitysharingd",
		],
	},
	{
		// News, Weather, Maps background data, Tips, and game controllers are unavailable.
		id: "apps",
		labels: [
			"com.apple.newsd",
			"com.apple.weatherd",
			"com.apple.Maps.mapssyncd",
			"com.apple.Maps.mapspushd",
			"com.apple.Maps.geocorrectiond",
			"com.apple.maps.destinationd",
			"com.apple.MapKit.SnapshotService",
			"com.apple.jetpackassetd",
			"com.apple.tipsd",
			"com.apple.gamesaved",
			"com.apple.GameController.gamecontrollerd",
		],
	},
	{
		// iMessage, FaceTime, and identity services do not work.
		id: "messaging",
		labels: [
			"com.apple.identityservicesd",
			"com.apple.ids_simd",
			"com.apple.imautomatichistorydeletionagent",
			"com.apple.imcore.imtransferagent",
			"com.apple.imdpersistence.IMDPersistenceAgent",
			"com.apple.facetimemessagestored",
			"com.apple.telephonyutilities.callservicesd",
		],
	},
	{
		// Declarative device management and MDM profile workflows do not work.
		id: "mdm",
		labels: [
			"com.apple.remotemanagementd",
			"com.apple.RemoteManagementAgent",
			"com.apple.managedassetsd",
		],
	},
	{
		// App Clips, accessibility asset downloads, merchant, business, and other background services are unavailable.
		id: "other",
		labels: [
			"com.apple.merchantd",
			"com.apple.coreidvd",
			"com.apple.businessservicesd",
			"com.apple.deviceaccessd",
			"com.apple.replicatord",
			"com.apple.linkd",
			"com.apple.ind",
			"com.apple.storagedatad",
			"com.apple.StatusKitAgent",
			"com.apple.countryd",
			"com.apple.mobileassetd",
			"com.apple.managedconfiguration.passcodenagd",
			"com.apple.accessibility.axassetsd",
			"com.apple.ClipServices.clipserviced",
		],
	},
] as const;

/** Never disabled: Spotlight leaks memory, XCUITest launches stall, share sheets fail. */
export const SLIM_REQUIRED_LABELS = [
	"com.apple.assistantd",
	"com.apple.gamed",
	"com.apple.sharingd",
] as const;

export const SLIM_LABELS: readonly string[] = [
	...new Set(SLIM_CATEGORIES.flatMap((category) => category.labels)),
];

type Execute = (
	command: string,
	args: string[],
	timeout: number,
) => Promise<{ error: Error | null; stdout: string; stderr: string }>;

/** The host override store is trusted only on iOS 18.5 and later. */
export function supportsSlimRuntime(runtime: string): boolean {
	const match = /SimRuntime\.iOS-(\d+)-(\d+)/.exec(runtime);
	if (!match) return false;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	return major > 18 || (major === 18 && minor >= 5);
}

/** The flat `<key>label</key><true/>|<false/>` dict that launchd_sim writes. */
export function parseDisabledStore(xml: string): Map<string, boolean> {
	const entries = new Map<string, boolean>();
	const pattern = /<key>([^<]*)<\/key>\s*<(true|false)\s*\/>/g;
	for (const match of xml.matchAll(pattern))
		entries.set(unescapeXml(match[1]!), match[2] === "true");
	return entries;
}

export function encodeDisabledStore(entries: Map<string, boolean>): string {
	const rows = [...entries.keys()]
		.sort()
		.map((label) => `\t<key>${escapeXml(label)}</key>\n\t<${entries.get(label) ? "true" : "false"}/>\n`)
		.join("");
	return (
		'<?xml version="1.0" encoding="UTF-8"?>\n' +
		'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
		`<plist version="1.0">\n<dict>\n${rows}</dict>\n</plist>\n`
	);
}

/** `launchctl print-disabled` lines: `"label" => disabled` (older: `=> true`). */
export function parsePrintDisabled(output: string): Set<string> {
	const disabled = new Set<string>();
	for (const match of output.matchAll(/"([^"]+)"\s*=>\s*(\w+)/g))
		if (match[2] === "disabled" || match[2] === "true") disabled.add(match[1]!);
	return disabled;
}

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function unescapeXml(value: string): string {
	return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

/** What agentsims owns for one device. `managed` maps a label to its prior store entry. */
type SlimRecord = {
	optOut: boolean;
	managed: Record<string, boolean | null>;
};

export type SlimStatus = {
	device: string;
	enabled: boolean;
	managed: number;
	disabled: number;
	booted: boolean;
};

export type SlimDevice = { state: string; runtime: string };

const UDID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const SPAWN_CONCURRENCY = 8;

export class IosSlimming {
	private readonly storeRoot: string;
	private readonly recordRoot: () => string;

	constructor(
		private readonly execute: Execute,
		options: { storeRoot?: string; recordRoot?: () => string } = {},
	) {
		this.storeRoot = options.storeRoot ?? "/private/var/tmp";
		this.recordRoot = options.recordRoot ?? (() => join(agentsimsHome(), "slim"));
	}

	/**
	 * Call before `simctl boot`. `requested` persists the user's choice; undefined
	 * keeps the stored one (default on). Returns true when this boot is slim.
	 */
	async prepare(udid: string, device: SlimDevice, requested?: boolean): Promise<boolean> {
		const record = await this.readRecord(udid);
		if (requested !== undefined && record.optOut === requested) {
			record.optOut = !requested;
			await this.writeRecord(udid, record);
		}
		if (device.state !== "Shutdown" || !supportsSlimRuntime(device.runtime))
			return false;
		if (record.optOut) {
			await this.revertStore(udid, record);
			return false;
		}
		await this.applyStore(udid, record);
		return true;
	}

	/**
	 * Call after boot. When launchd_sim did not take the store overrides, disable
	 * and stop the labels in the running device. Never throws.
	 */
	async verify(udid: string): Promise<void> {
		try {
			const record = await this.readRecord(udid);
			const ours = Object.keys(record.managed);
			const disabled = await this.printDisabled(udid);
			if (!disabled) return;
			const missing = ours.filter((label) => !disabled.has(label));
			if (missing.length === 0) return;
			logRuntime(
				`ios:${udid}`,
				`Slim overrides did not hold for ${missing.length} services. Disabling them in the running device.`,
			);
			await this.launchctl(udid, missing, "disable");
			await this.launchctl(udid, missing, "bootout");
		} catch (error) {
			logRuntime(
				`ios:${udid}`,
				`Slim check failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/** Turn slimming on or off for a device. Changes apply at the next boot. */
	async setEnabled(udid: string, device: SlimDevice, enabled: boolean): Promise<SlimStatus> {
		const record = await this.readRecord(udid);
		record.optOut = !enabled;
		await this.writeRecord(udid, record);
		const booted = device.state === "Booted";
		if (supportsSlimRuntime(device.runtime)) {
			// A booted launchd_sim rewrites the store from memory, so change its overrides too.
			const labels = enabled ? SLIM_LABELS : Object.keys(record.managed);
			if (enabled) await this.applyStore(udid, record);
			else await this.revertStore(udid, record);
			if (booted) await this.launchctl(udid, labels, enabled ? "disable" : "enable");
		}
		return this.status(udid, device);
	}

	async status(udid: string, device: SlimDevice): Promise<SlimStatus> {
		const record = await this.readRecord(udid);
		const ours = Object.keys(record.managed);
		const booted = device.state === "Booted";
		const disabled =
			(booted ? await this.printDisabled(udid) : null) ??
			new Set(
				[...(await this.readStore(udid))]
					.filter(([, off]) => off)
					.map(([label]) => label),
			);
		return {
			device: udid,
			enabled: !record.optOut,
			managed: ours.length,
			disabled: ours.filter((label) => disabled.has(label)).length,
			booted,
		};
	}

	private async applyStore(udid: string, record: SlimRecord): Promise<void> {
		const entries = await this.readStore(udid);
		let changed = false;
		for (const label of SLIM_LABELS) {
			if (label in record.managed) {
				if (entries.get(label) !== true) {
					entries.set(label, true);
					changed = true;
				}
				continue;
			}
			// Someone else disabled it already. It is not ours to revert.
			if (entries.get(label) === true) continue;
			record.managed[label] = entries.get(label) ?? null;
			entries.set(label, true);
			changed = true;
		}
		if (!changed) return;
		await this.writeRecord(udid, record);
		await this.writeStore(udid, entries);
	}

	private async revertStore(udid: string, record: SlimRecord): Promise<void> {
		const labels = Object.keys(record.managed);
		if (labels.length === 0) return;
		const entries = await this.readStore(udid);
		for (const label of labels) {
			const prior = record.managed[label];
			if (prior === null || prior === undefined) entries.delete(label);
			else entries.set(label, prior);
		}
		await this.writeStore(udid, entries);
		record.managed = {};
		await this.writeRecord(udid, record);
	}

	private storePath(udid: string): string {
		if (!UDID.test(udid)) throw new Error("Slim boot requires a simulator UDID");
		return join(this.storeRoot, `com.apple.CoreSimulator.SimDevice.${udid}`, "disabled.plist");
	}

	private async readStore(udid: string): Promise<Map<string, boolean>> {
		try {
			return parseDisabledStore(await readFile(this.storePath(udid), "utf8"));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
			throw error;
		}
	}

	/** Atomic, so launchd_sim never reads a partial store. */
	private async writeStore(udid: string, entries: Map<string, boolean>): Promise<void> {
		const path = this.storePath(udid);
		const directory = join(path, "..");
		await mkdir(directory, { recursive: true, mode: 0o700 });
		const temporary = `${path}.agentsims-${process.pid}`;
		try {
			await writeFile(temporary, encodeDisabledStore(entries), { mode: 0o644 });
			await rename(temporary, path);
		} finally {
			await rm(temporary, { force: true });
		}
	}

	private recordPath(udid: string): string {
		if (!UDID.test(udid)) throw new Error("Slim boot requires a simulator UDID");
		return join(this.recordRoot(), `${udid}.json`);
	}

	private async readRecord(udid: string): Promise<SlimRecord> {
		try {
			const parsed = JSON.parse(await readFile(this.recordPath(udid), "utf8")) as Partial<SlimRecord>;
			return { optOut: parsed.optOut === true, managed: { ...parsed.managed } };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT")
				return { optOut: false, managed: {} };
			throw error;
		}
	}

	private async writeRecord(udid: string, record: SlimRecord): Promise<void> {
		const path = this.recordPath(udid);
		await mkdir(join(path, ".."), { recursive: true });
		const temporary = `${path}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`);
		await rename(temporary, path);
	}

	private async printDisabled(udid: string): Promise<Set<string> | null> {
		const result = await this.execute(
			"xcrun",
			["simctl", "spawn", udid, "launchctl", "print-disabled", "system"],
			15_000,
		);
		return result.error ? null : parsePrintDisabled(result.stdout);
	}

	/** The runtime has no shell, so each label is one spawn. */
	private async launchctl(
		udid: string,
		labels: readonly string[],
		verb: "disable" | "enable" | "bootout",
	): Promise<void> {
		for (let index = 0; index < labels.length; index += SPAWN_CONCURRENCY) {
			await Promise.all(
				labels.slice(index, index + SPAWN_CONCURRENCY).map((label) =>
					this.execute(
						"xcrun",
						["simctl", "spawn", udid, "launchctl", verb, `system/${label}`],
						15_000,
					),
				),
			);
		}
	}
}
