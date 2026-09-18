import { formatFields, formatTable } from "./output";

const str = (value: unknown): string =>
	typeof value === "string" ? value : value == null ? "" : String(value);

/** iOS returns `InstalledApp[]`; Android returns `{ apps: [{ package, system }] }`. */
export function renderAppList(payload: unknown, all: boolean): string {
	const androidApps = (payload as { apps?: unknown[] })?.apps;
	const android = !Array.isArray(payload) && Array.isArray(androidApps);
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(androidApps)
			? androidApps
			: [];
	const rows = list
		.map((entry) => entry as Record<string, unknown>)
		.map((app) => ({
			id: str(app.bundleId ?? app.package ?? app.id),
			name: str(app.name ?? app.displayName),
			version: str(app.version ?? app.shortVersion),
			system: app.system === true,
		}))
		.filter((app) => app.id && (all || !app.system));
	if (android)
		return formatTable(
			["PACKAGE ID", "TYPE"],
			rows.map((app) => [app.id, app.system ? "system" : "user"]),
			all
				? "No apps installed."
				: "No user apps installed. Use --all to include system apps.",
		);
	return formatTable(
		["APP ID", "NAME", "VERSION", "TYPE"],
		rows.map((app) => [
			app.id,
			app.name,
			app.version || "-",
			app.system ? "system" : "user",
		]),
		all
			? "No apps installed."
			: "No user apps installed. Use --all to include system apps.",
	);
}

export function renderWebcamList(payload: unknown): string {
	const value = (payload ?? {}) as {
		webcams?: { id?: string; label?: string }[];
		faceRequired?: boolean;
	};
	const table = formatTable(
		["WEBCAM ID", "LABEL"],
		(value.webcams ?? []).map((cam) => [str(cam.id), str(cam.label)]),
		"No host webcams available.",
	);
	return value.faceRequired
		? `${table}\n\nThis device needs --face front|back with \`camera use\`.`
		: table;
}

function unknownPermissionState(value: unknown): string {
	const detail = JSON.stringify(value);
	return `unknown (${detail ?? String(value)})`;
}

function renderTccState(value: unknown): string {
	if (value === 0) return "denied";
	if (value === 2) return "granted";
	if (value === 3) return "limited";
	return unknownPermissionState(value);
}

function renderLocationState(value: unknown): string {
	const authorization = (value as { Authorization?: unknown })?.Authorization;
	if (authorization === 1) return "never";
	if (authorization === 2) return "in use";
	if (authorization === 4) return "always";
	return unknownPermissionState(authorization ?? value);
}

function renderNotificationState(value: unknown): string {
	const state = value as {
		allowsNotifications?: unknown;
		critical?: unknown;
	};
	if (state?.allowsNotifications === false) return "denied";
	if (state?.allowsNotifications === true)
		return state.critical === true ? "critical" : "granted";
	return unknownPermissionState(value);
}

export function renderPermissionList(payload: unknown): string {
	const value = (payload ?? {}) as {
		bundleId?: string | null;
		packageName?: string;
		tcc?: Record<string, unknown>;
		location?: unknown;
		notifications?: unknown;
		runtime?: { permission?: string; granted?: boolean }[];
	};
	if (Array.isArray(value.runtime))
		return formatTable(
			["PERMISSION", "STATE"],
			value.runtime.map((entry) => [
				str(entry.permission),
				entry.granted ? "granted" : "denied",
			]),
			`No runtime permissions declared by ${str(value.packageName) || "the app"}.`,
		);
	const rows: [string, string][] = Object.entries(value.tcc ?? {}).map(
		([name, state]) => [name, renderTccState(state)],
	);
	if (value.location != null)
		rows.push(["location", renderLocationState(value.location)]);
	if (value.notifications != null)
		rows.push(["notifications", renderNotificationState(value.notifications)]);
	if (rows.length === 0)
		return `No permission state recorded for ${str(value.bundleId) || "the app"}. The app may not be installed, or it has not requested any permission yet.`;
	return formatFields(rows);
}

export function renderServerStatus(payload: unknown): string {
	const value = (payload ?? {}) as {
		running?: boolean;
		url?: string;
		pid?: number;
		startedAt?: string;
		logFile?: string;
	};
	if (value.running === false || !value.url)
		return "Agentsims is not running. Start it with `agentsims start --detach`.";
	return formatFields([
		["url", str(value.url)],
		["pid", str(value.pid)],
		["since", str(value.startedAt)],
		["logs", str(value.logFile)],
	]);
}
