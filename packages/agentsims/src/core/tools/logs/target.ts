import { InvalidCommandInput } from "../errors";
import type { LogQuery, LogTarget } from "./contracts";
import { formatLogCursor, logDevice, parseLogQuery } from "./query";

function invalid(message: string): never {
	throw new InvalidCommandInput({ message });
}
function fields(
	value: unknown,
	keys: readonly string[],
): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		invalid("Invalid application log target");
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record))
		if (!keys.includes(key))
			invalid(`Unknown application log target field: ${key}`);
	return record;
}
function identity(value: unknown, field: string, maximum = 512): string {
	if (
		typeof value !== "string" ||
		!value ||
		value.length > maximum ||
		value.trim() !== value ||
		[...value].some(
			(character) =>
				character.codePointAt(0)! < 32 || character.codePointAt(0) === 127,
		)
	)
		invalid(`Invalid log ${field}`);
	try {
		encodeURIComponent(value);
	} catch {
		invalid(`Invalid log ${field}`);
	}
	return value;
}
function pid(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 1 ||
		value > 2_147_483_647
	)
		invalid("Log target PID must be a positive integer");
	return value;
}

export function parseLogTarget(value: unknown): LogTarget {
	const input = fields(value, ["device", "app", "projectId", "reactNative"]);
	const app = fields(input.app, ["mode", "id", "pid"]);
	let selected: LogTarget["app"];
	if (app.mode === "foreground") {
		if (app.id !== undefined || app.pid !== undefined)
			invalid("A foreground log target cannot fix an app or PID");
		selected = Object.freeze({ mode: "foreground" });
	} else if (app.mode === "fixed") {
		selected = Object.freeze({
			mode: "fixed",
			id: identity(app.id, "target application"),
			pid: app.pid === undefined ? undefined : pid(app.pid),
		});
	} else invalid("Select a foreground or fixed log application");
	let projectId =
		input.projectId === undefined
			? undefined
			: identity(input.projectId, "project ID");
	let reactNative: LogTarget["reactNative"];
	if (input.reactNative !== undefined) {
		const rn = fields(input.reactNative, ["projectId", "metroUrl", "targetId"]);
		const rnProject = identity(rn.projectId, "inspector project ID");
		if (projectId !== undefined && projectId !== rnProject)
			invalid("Log and inspector project IDs must match");
		projectId = rnProject;
		let metro: URL;
		try {
			metro = new URL(identity(rn.metroUrl, "Metro URL", 2_048));
		} catch {
			return invalid("Select a local Metro HTTP origin");
		}
		if (
			!["http:", "https:"].includes(metro.protocol) ||
			!["localhost", "127.0.0.1", "[::1]"].includes(metro.hostname) ||
			metro.username ||
			metro.password ||
			metro.pathname !== "/" ||
			metro.search ||
			metro.hash
		)
			invalid("Select a local Metro HTTP origin");
		reactNative = Object.freeze({
			projectId: rnProject,
			metroUrl: metro.origin,
			targetId: identity(rn.targetId, "inspector target ID"),
		});
	}
	return Object.freeze({
		device: logDevice(input.device),
		app: selected,
		projectId,
		reactNative,
	});
}

export type LogRequest = {
	readonly target: LogTarget;
	readonly query: LogQuery;
};
const targetFields = [
	"targetApp",
	"targetPid",
	"projectId",
	"metroUrl",
	"targetId",
] as const;

/** Target selection stays separate from historical app/process filters. */
export function parseLogRequest(params: URLSearchParams): LogRequest {
	const query = new URLSearchParams();
	const target: Record<string, string> = Object.create(null);
	for (const [key, value] of params) {
		if ((targetFields as readonly string[]).includes(key)) {
			if (Object.hasOwn(target, key))
				invalid(`Duplicate log target field: ${key}`);
			target[key] = value;
		} else query.append(key, value);
	}
	const parsed = parseLogQuery(query);
	if (target.targetPid !== undefined && target.targetApp === undefined)
		invalid("A log target PID requires a target application");
	if (target.targetPid !== undefined && !/^\d+$/.test(target.targetPid))
		invalid("Log target PID must be a positive integer");
	const hasInspector =
		target.metroUrl !== undefined || target.targetId !== undefined;
	return Object.freeze({
		query: parsed,
		target: parseLogTarget({
			device: parsed.device,
			app:
				target.targetApp === undefined
					? { mode: "foreground" }
					: {
							mode: "fixed",
							id: target.targetApp,
							pid:
								target.targetPid === undefined
									? undefined
									: Number(target.targetPid),
						},
			projectId: target.projectId,
			reactNative: hasInspector
				? {
						projectId: target.projectId,
						metroUrl: target.metroUrl,
						targetId: target.targetId,
					}
				: undefined,
		}),
	});
}

export function logRequestParams(
	targetInput: LogTarget,
	queryInput: unknown,
): URLSearchParams {
	const target = parseLogTarget(targetInput);
	const query = parseLogQuery(queryInput);
	if (target.device !== query.device)
		invalid("Log query and target must select the same device");
	const params = new URLSearchParams({
		device: target.device,
		limit: String(query.limit),
	});
	if (target.app.mode === "fixed") {
		params.set("targetApp", target.app.id);
		if (target.app.pid !== undefined)
			params.set("targetPid", String(target.app.pid));
	}
	if (target.projectId) params.set("projectId", target.projectId);
	if (target.reactNative) {
		params.set("metroUrl", target.reactNative.metroUrl);
		params.set("targetId", target.reactNative.targetId);
	}
	if (query.after) params.set("cursor", formatLogCursor(query.after));
	if (query.query !== undefined) params.set("query", query.query);
	if (query.level) params.set("level", query.level);
	if (query.sources) params.set("sources", query.sources.join(","));
	if (query.app !== undefined) params.set("app", query.app);
	if (query.pid !== undefined) params.set("pid", String(query.pid));
	if (query.process !== undefined) params.set("process", query.process);
	return params;
}
