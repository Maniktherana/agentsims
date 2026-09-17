import type { ActionResult } from "../core/tools/actions";
import type { AxViewNode } from "../core/tools/observe/ax-view";
import type {
	DeviceMatches,
	DeviceObservation,
	DeviceScreenshot,
	ImageCaptureChannel,
} from "../core/tools/observe/observe";
import type { DeviceSnapshot } from "../core/tools/observe/snapshot-store";
import type {
	ResolvedAction,
	ResolvedPoint,
} from "../core/tools/observe/targets";

export type { DeviceMatches };

export interface ObserveFormat {
	frames?: boolean;
	raw?: boolean;
}

export type ArtifactWrite =
	| { status: "ok"; path: string }
	| { status: "error"; error: string };

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();
const quoted = (value: string): string => JSON.stringify(value);
const time = (value: number): string => new Date(value).toISOString();

export function renderAxNode(
	node: AxViewNode,
	depth: number,
	format: ObserveFormat = {},
): string {
	const role = format.raw ? node.rawRole || node.role : node.role;
	const label = node.label ? ` "${oneLine(node.label)}"` : "";
	const states = node.states.map((state) => ` [${state}]`).join("");
	const box = format.frames
		? ` [box=${node.box.x},${node.box.y},${node.box.width},${node.box.height}]`
		: "";
	const testId = node.testId ? ` [testid=${node.testId}]` : "";
	const value = node.value ? `: ${oneLine(node.value)}` : "";
	return `${"  ".repeat(depth)}- ${role}${label} [ref=${node.ref}]${states}${box}${testId}${value}`;
}

export function renderAxNodes(
	nodes: readonly AxViewNode[],
	format: ObserveFormat = {},
	depth = 0,
): string[] {
	return nodes.flatMap((node) => [
		renderAxNode(node, depth, format),
		...renderAxNodes(node.children, format, depth + 1),
	]);
}

function warningLines(values: readonly unknown[]): string[] {
	return values.map(
		(warning) =>
			`warning  ${typeof warning === "string" ? warning : JSON.stringify(warning)}`,
	);
}

function renderTree(view: DeviceSnapshot, format: ObserveFormat): string[] {
	const rest = view.shown < view.total ? "  (--all for the rest)" : "";
	return [
		`elements  ${view.shown} shown / ${view.total} total${rest}`,
		"",
		...renderAxNodes(view.nodes, format),
	];
}

function renderImage(
	image: ImageCaptureChannel,
	reason?: string | null,
): string {
	const prefix = reason
		? `image  ${image.status}  reason=${reason}`
		: `image  ${image.status}`;
	if (image.status === "error")
		return `${prefix}  captured=${time(image.capturedAt)}  ${oneLine(image.error)}`;
	const value = image.value;
	return [
		prefix,
		`captured=${time(image.capturedAt)}`,
		`capture=${value.captureId ?? "none"}`,
		`${value.width}×${value.height}`,
		value.observationId ? `observation=${value.observationId}` : "",
	]
		.filter(Boolean)
		.join("  ");
}

function renderArtifact(artifact: ArtifactWrite | null): string | null {
	if (!artifact) return null;
	return artifact.status === "ok"
		? `artifact  ok  path=${artifact.path}`
		: `artifact  error  ${oneLine(artifact.error)}`;
}

function renderContext(result: DeviceObservation | DeviceScreenshot): string {
	const context = result.context;
	return [
		"context",
		`app=${context.app ?? "unknown"}`,
		`orientation=${context.orientation ?? "unknown"}`,
		`generation=${context.generation ?? "unknown"}`,
		`changed=${context.changedDuringCapture ? "yes" : "no"}`,
	].join("  ");
}

export function renderObservation(
	observation: DeviceObservation,
	artifact: ArtifactWrite | null,
	format: ObserveFormat = {},
): string {
	const accessibility = observation.accessibility;
	const artifactLine = renderArtifact(artifact);
	const rows = [
		[
			"observe",
			`device=${observation.device}`,
			`platform=${observation.platform}`,
			`observation=${observation.observationId ?? "none"}`,
			`capture=${observation.captureId ?? "none"}`,
			`started=${time(observation.startedAt)}`,
			`completed=${time(observation.completedAt)}`,
		].join("  "),
		accessibility.status === "ok"
			? `accessibility  ok  captured=${time(accessibility.capturedAt)}  observation=${accessibility.value.observationId}`
			: `accessibility  error  captured=${time(accessibility.capturedAt)}  ${oneLine(accessibility.error)}`,
		renderImage(observation.image),
		...(artifactLine ? [artifactLine] : []),
		renderContext(observation),
	];
	if (observation.view) rows.push(...renderTree(observation.view, format));
	else rows.push("elements  none");
	rows.push(
		...warningLines([
			...observation.warnings,
			...(observation.view?.warnings ?? []),
		]),
	);
	return rows.join("\n");
}

export function renderScreenshot(
	screenshot: DeviceScreenshot,
	artifact: ArtifactWrite | null,
): string {
	const artifactLine = renderArtifact(artifact);
	return [
		[
			"screenshot",
			`device=${screenshot.device}`,
			`platform=${screenshot.platform}`,
			`capture=${screenshot.captureId ?? "none"}`,
			`started=${time(screenshot.startedAt)}`,
			`completed=${time(screenshot.completedAt)}`,
		].join("  "),
		renderImage(screenshot.image),
		...(artifactLine ? [artifactLine] : []),
		renderContext(screenshot),
		...warningLines(screenshot.warnings),
	].join("\n");
}

export function renderMatches(
	matches: DeviceMatches,
	format: ObserveFormat = {},
): string {
	if (matches.nodes.length === 0)
		return `no node matches "${matches.query}" in observation ${matches.snapshot}`;
	return matches.nodes.map((node) => renderAxNode(node, 0, format)).join("\n");
}

function percent(value: number): string {
	return `${(value * 100).toFixed(1)}%`;
}

export function renderPoint(point: ResolvedPoint): string {
	const where = point.pixels
		? `${point.pixels.x},${point.pixels.y} px`
		: `${percent(point.x)},${percent(point.y)}`;
	const capture = point.capture ? ` capture=${point.capture}` : "";
	if (!point.ref) return `${where}${capture}`;
	const label = point.label ? ` "${oneLine(point.label)}"` : "";
	return `${point.role ?? "node"}${label} @${point.ref} at ${where}${capture}`;
}

const KEY_NAMES: Record<string, string> = {
	enter: "Return",
	"select-all": "Select All",
	delete: "Delete",
};

function renderNode(point: ResolvedPoint): string {
	const label = point.label ? ` "${oneLine(point.label)}"` : "";
	const ref = point.ref ? ` @${point.ref}` : "";
	return `${point.role ?? "node"}${label}${ref}`;
}

function renderTypeLine(action: ResolvedAction): string {
	const verb = action.cleared ? "fill" : "type";
	const into = action.into ? ` into ${renderNode(action.into)}` : "";
	const value =
		action.value === undefined || action.value === null
			? ""
			: `  value=${quoted(action.value)}`;
	return `${verb} ${quoted(action.text ?? "")}${into}${value}`;
}

function renderActionLine(action: ResolvedAction): string {
	switch (action.type) {
		case "long-press":
			return action.from
				? `long-press ${renderPoint(action.from)}`
				: "long-press";
		case "swipe":
			return action.from && action.to
				? `swipe from ${renderPoint(action.from)} to ${renderPoint(action.to)}`
				: "swipe";
		case "gesture":
			return `gesture${action.phase ? ` ${action.phase}` : ""}${
				action.from ? ` at ${renderPoint(action.from)}` : ""
			}`;
		case "type":
			return renderTypeLine(action);
		case "key":
			return `press ${KEY_NAMES[action.key ?? ""] ?? action.key ?? ""}`.trim();
		case "button":
			return `press ${action.button ?? ""}`.trim();
		case "rotate":
			return `rotate ${action.orientation ?? ""}`.trim();
		default:
			return action.from ? `tap ${renderPoint(action.from)}` : "tap";
	}
}

export function renderActionResult(
	result: ActionResult,
	artifact: ArtifactWrite | null = null,
	format: ObserveFormat = {},
): string {
	const lines = result.resolved.map(
		(action) => `action  ${renderActionLine(action)}`,
	);
	lines.push(`dispatch  ${result.dispatch.status}  ${result.dispatch.reason}`);
	lines.push(
		`verification  ${result.verification.status}  ${result.verification.reason}`,
	);
	if (
		result.text?.submit.status === "suppressed" ||
		result.text?.submit.status === "unknown"
	)
		lines.push(
			`submit  ${result.text.submit.status}  ${result.text.submit.reason}`,
		);
	const accessibility = result.accessibility;
	lines.push(
		accessibility.status === "ok"
			? `accessibility  ok  captured=${time(accessibility.capturedAt)}  observation=${accessibility.value.observationId}`
			: `accessibility  error  captured=${time(accessibility.capturedAt)}  ${oneLine(accessibility.error)}`,
	);
	if (result.image)
		lines.push(renderImage(result.image, result.captureReason));
	else lines.push("image  not_requested");
	const artifactLine = renderArtifact(artifact);
	if (artifactLine) lines.push(artifactLine);
	if (result.view) lines.push(...renderTree(result.view, format));
	else lines.push("elements  none");
	lines.push(
		...warningLines([
			...result.warnings,
			...(result.view?.warnings ?? []),
		]),
	);
	return lines.join("\n");
}

function imageForOutput(image: ImageCaptureChannel): unknown {
	if (image.status === "error") return image;
	const { bytes: _bytes, ...value } = image.value;
	return { ...image, value };
}

function accessibilityForOutput(
	accessibility: DeviceObservation["accessibility"],
): unknown {
	if (accessibility.status === "error") return accessibility;
	return {
		status: accessibility.status,
		capturedAt: accessibility.capturedAt,
		value: { observationId: accessibility.value.observationId },
	};
}

export function observationForOutput(
	observation: DeviceObservation,
	artifact: ArtifactWrite | null,
): unknown {
	return {
		...observation,
		accessibility: accessibilityForOutput(observation.accessibility),
		image: imageForOutput(observation.image),
		artifact,
	};
}

export function screenshotForOutput(
	screenshot: DeviceScreenshot,
	artifact: ArtifactWrite | null,
): unknown {
	return {
		...screenshot,
		image: imageForOutput(screenshot.image),
		artifact,
	};
}

export function actionForOutput(
	result: ActionResult,
	artifact: ArtifactWrite | null,
): unknown {
	return {
		...result,
		accessibility: accessibilityForOutput(result.accessibility),
		image: result.image ? imageForOutput(result.image) : null,
		artifact,
	};
}
