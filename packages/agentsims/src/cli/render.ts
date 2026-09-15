import { formatFields, formatTable } from "./output";

const str = (value: unknown): string =>
	typeof value === "string" ? value : value == null ? "" : String(value);

/** iOS returns `InstalledApp[]`; Android returns `{ apps: [{ package, system }] }`. */
export function renderAppList(payload: unknown, all: boolean): string {
	const list = Array.isArray(payload)
		? payload
		: Array.isArray((payload as { apps?: unknown[] })?.apps)
			? (payload as { apps: unknown[] }).apps
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
		([name, state]) => [name, str(state)],
	);
	if (value.location != null) rows.push(["location", str(value.location)]);
	if (value.notifications != null)
		rows.push(["notifications", str(value.notifications)]);
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
