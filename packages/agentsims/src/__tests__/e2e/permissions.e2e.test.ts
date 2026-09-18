import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { execFileSync, execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
	explicitIosDevice,
	sourceCliPath,
	startOwnedE2EServer,
	type OwnedE2EServer,
} from "../helpers/native-e2e";
import {
	acquireIosSimulatorTestLock,
	IOS_E2E_HOOK_TIMEOUT_MS,
} from "../helpers/ios-e2e-lock";

const FAKE_BUNDLE = "com.agentsims.permissions-e2e";
// Location goes through `simctl privacy`, which no-ops on a bundle id that
// isn't installed — so location assertions need a real stock app.
const REAL_APP = "com.apple.mobilecal";
const udid = explicitIosDevice;
const describeIfSim = udid ? describe : describe.skip;
let server: OwnedE2EServer;
let releaseLock = () => {};
let priorLocationAuth: number | null = null;
let capturedLocationAuth = false;

function cli(...args: string[]): string {
	const [operation, first, second, ...rest] = args;
	const bundleId = operation === "list" ? first : second;
	const permission = operation === "list" || first === "all" ? [] : [first!];
	return execFileSync(
		process.execPath,
		[
			sourceCliPath,
			"permissions",
			operation!,
			...permission,
			"-d",
			udid!,
			"-a",
			bundleId!,
			...(operation === "list" ? ["--json"] : rest),
			"--url",
			server.origin,
		],
		{
			encoding: "utf-8",
		},
	);
}

function libDir(): string {
	return join(
		homedir(),
		"Library/Developer/CoreSimulator/Devices",
		udid!,
		"data/Library",
	);
}

function tccAuthValue(service: string): string {
	const db = join(libDir(), "TCC/TCC.db");
	return execSync(
		`sqlite3 "${db}" "SELECT auth_value FROM access WHERE service='${service}' AND client='${FAKE_BUNDLE}';"`,
		{ encoding: "utf-8" },
	).trim();
}

function bulletinXml(): string {
	const plist = join(libDir(), "BulletinBoard/VersionedSectionInfo.plist");
	return execSync(`plutil -convert xml1 -o - "${plist}"`, {
		encoding: "utf-8",
	});
}

// Decode the per-app section-info keyed archive nested as a <data> blob under
// `sectionInfo.<bundleId>`. `plutil -extract` can't address the dotted bundle
// id, so pull the whole sectionInfo dict and find the entry by hand.
function sectionInfoInnerXml(): string {
	const plist = join(libDir(), "BulletinBoard/VersionedSectionInfo.plist");
	const xml = execSync(`plutil -extract sectionInfo xml1 -o - "${plist}"`, {
		encoding: "utf-8",
	});
	const m = xml.match(
		new RegExp(
			`<key>${FAKE_BUNDLE.replace(/[.-]/g, "\\$&")}</key>\\s*<data>([\\s\\S]*?)</data>`,
		),
	);
	if (!m?.[1]) throw new Error(`no sectionInfo entry for ${FAKE_BUNDLE}`);
	const blob = Buffer.from(m[1].replace(/\s/g, ""), "base64");
	const tmp = join(libDir(), "..", `.agentsims-e2e-${Date.now()}.plist`);
	require("fs").writeFileSync(tmp, blob);
	try {
		return execSync(`plutil -convert xml1 -o - "${tmp}"`, {
			encoding: "utf-8",
		});
	} finally {
		require("fs").rmSync(tmp, { force: true });
	}
}

// locationd keys entries as `i<bundleId>:`; pull the Authorization integer out
// of that entry's dict.
function locationAuth(bundleId: string): number | null {
	const plist = join(libDir(), "Caches/locationd/clients.plist");
	if (!existsSync(plist)) return null;
	const xml = execSync(`plutil -convert xml1 -o - "${plist}"`, {
		encoding: "utf-8",
	});
	const m = xml.match(
		new RegExp(
			`<key>i${bundleId.replace(/[.-]/g, "\\$&")}:</key>\\s*<dict>[\\s\\S]*?` +
				`<key>Authorization</key>\\s*<integer>(\\d+)</integer>`,
		),
	);
	return m ? Number(m[1]) : null;
}

// `simctl privacy` writes locationd's clients.plist asynchronously, so on a cold
// CI sim the value can lag the `grant`/`revoke` CLI call returning. Poll the
// readback until it reaches the expected Authorization rather than asserting on
// the first (possibly stale) read.
async function locationAuthEventually(
	bundleId: string,
	expected: number | null,
): Promise<number | null> {
	let last: number | null = null;
	for (let i = 0; i < 40; i++) {
		last = locationAuth(bundleId);
		if (last === expected) return last;
		await new Promise((r) => setTimeout(r, 250));
	}
	return last;
}

async function restoreLocationAuth(value: number | null): Promise<void> {
	if (value === null) cli("reset", "location", REAL_APP);
	else if (value === 1) cli("revoke", "location", REAL_APP);
	else if (value === 3) cli("grant", "location", REAL_APP, "--value", "inuse");
	else if (value === 4) cli("grant", "location", REAL_APP, "--value", "always");
	else throw new Error(`Cannot restore location Authorization=${value}.`);
	const restored = await locationAuthEventually(REAL_APP, value);
	if (restored !== value)
		throw new Error(
			`Failed to restore Calendar location permission: expected ${value}, got ${restored}.`,
		);
}

// Each case shells the built CLI a few times, and a cold `simctl privacy`
// call (location) can take several seconds on a fresh CI sim — comfortably
// past bun's 5s default. The beforeAll reset-all also cascades through every
// permission while the sim is fully cold, and that first touch has been seen
// to run past 90s on a GitHub macOS runner, so keep the budget well above it.
const T = 150_000;

describeIfSim("Agentsims permissions (real simulator)", () => {
	beforeAll(async () => {
		releaseLock = await acquireIosSimulatorTestLock(udid!);
		priorLocationAuth = locationAuth(REAL_APP);
		capturedLocationAuth = true;
		server = await startOwnedE2EServer();
		// Start from a known-clean slate for the fake bundle.
		cli("reset", "all", FAKE_BUNDLE);
	}, T);

	afterAll(async () => {
		try {
			if (server) {
				try {
					cli("reset", "all", FAKE_BUNDLE);
				} finally {
					if (capturedLocationAuth)
						await restoreLocationAuth(priorLocationAuth);
				}
			}
		} finally {
			try {
				await server?.stop();
			} finally {
				releaseLock();
			}
		}
	}, IOS_E2E_HOOK_TIMEOUT_MS);

	test(
		"grant camera writes a TCC row with auth_value=2",
		() => {
			cli("grant", "camera", FAKE_BUNDLE);
			expect(tccAuthValue("kTCCServiceCamera")).toBe("2");
		},
		T,
	);

	test(
		"revoke camera flips auth_value to 0",
		() => {
			cli("revoke", "camera", FAKE_BUNDLE);
			expect(tccAuthValue("kTCCServiceCamera")).toBe("0");
		},
		T,
	);

	test(
		"reset camera removes the TCC row",
		() => {
			cli("grant", "camera", FAKE_BUNDLE);
			cli("reset", "camera", FAKE_BUNDLE);
			expect(tccAuthValue("kTCCServiceCamera")).toBe("");
		},
		T,
	);

	test(
		"grant photos --value limited writes auth_value=3",
		() => {
			cli("grant", "photos", FAKE_BUNDLE, "--value", "limited");
			expect(tccAuthValue("kTCCServicePhotos")).toBe("3");
		},
		T,
	);

	test(
		"grant notifications sets allowsNotifications=true in BulletinBoard",
		() => {
			cli("grant", "notifications", FAKE_BUNDLE);
			expect(bulletinXml()).toContain(FAKE_BUNDLE);
			expect(sectionInfoInnerXml()).toMatch(
				/<key>allowsNotifications<\/key>\s*<true\/>/,
			);
		},
		T,
	);

	test(
		"grant notifications --value critical sets criticalAlertSetting=2",
		() => {
			cli("grant", "notifications", FAKE_BUNDLE, "--value", "critical");
			expect(sectionInfoInnerXml()).toMatch(
				/<key>criticalAlertSetting<\/key>\s*<integer>2<\/integer>/,
			);
		},
		T,
	);

	test(
		"revoke notifications sets allowsNotifications=false",
		() => {
			cli("revoke", "notifications", FAKE_BUNDLE);
			expect(sectionInfoInnerXml()).toMatch(
				/<key>allowsNotifications<\/key>\s*<false\/>/,
			);
		},
		T,
	);

	test(
		"reset notifications removes the bundle entry",
		() => {
			cli("grant", "notifications", FAKE_BUNDLE);
			cli("reset", "notifications", FAKE_BUNDLE);
			expect(bulletinXml()).not.toContain(FAKE_BUNDLE);
		},
		T,
	);

	test(
		"grant location --value always writes Authorization=4",
		async () => {
			cli("grant", "location", REAL_APP, "--value", "always");
			expect(await locationAuthEventually(REAL_APP, 4)).toBe(4);
		},
		T,
	);

	test(
		"revoke location downgrades Authorization to never (1)",
		async () => {
			cli("revoke", "location", REAL_APP);
			expect(await locationAuthEventually(REAL_APP, 1)).toBe(1);
		},
		T,
	);

	test(
		"reset all clears the TCC and notification stores for the bundle",
		() => {
			cli("grant", "camera", FAKE_BUNDLE);
			cli("grant", "notifications", FAKE_BUNDLE);
			cli("reset", "all", FAKE_BUNDLE);
			expect(tccAuthValue("kTCCServiceCamera")).toBe("");
			expect(bulletinXml()).not.toContain(FAKE_BUNDLE);
		},
		T,
	);

	test(
		"list reports state under the CLI's own permission names",
		async () => {
			cli("grant", "camera", FAKE_BUNDLE);
			cli("grant", "notifications", FAKE_BUNDLE);
			cli("grant", "location", REAL_APP, "--value", "always");
			// Wait for locationd to persist the grant before reading it back via `list`.
			expect(await locationAuthEventually(REAL_APP, 4)).toBe(4);
			const fake = JSON.parse(cli("list", FAKE_BUNDLE));
			expect(fake.tcc.camera).toBe(2);
			expect(fake.notifications.allowsNotifications).toBe(true);
			const realOut = JSON.parse(cli("list", REAL_APP));
			expect(realOut.udid).toBe(udid);
			expect(realOut.location.Authorization).toBe(4);
			cli("reset", "all", FAKE_BUNDLE);
		},
		T,
	);
});
