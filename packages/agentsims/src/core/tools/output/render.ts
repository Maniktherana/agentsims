import type { ActionResult } from "../actions";
import type { AxViewNode } from "../observe/ax-view";
import type {
	DeviceMatches,
	DeviceObservation,
	DeviceScreenshot,
	ImageCaptureChannel,
} from "../observe/observe";
import type { DeviceSnapshot } from "../observe/snapshot-store";
import {
	describeSequenceStep,
	type SequenceResult,
} from "../sequence";
import type {
	DeviceWait,
	DeviceWatch,
	FrameSampling,
} from "../observe/watch";
import type {
	ResolvedAction,
	ResolvedPoint,
} from "../observe/targets";
import type { ScrollItem, ScrollResult } from "../scroll";
import type { TraceCommand } from "../traces/trace-file";

export type { DeviceMatches };

export interface ObserveFormat {
	frames?: boolean;
	raw?: boolean;
}

export type ArtifactWrite =
	| { status: "ok"; path: string }
	| { status: "error"; error: string };

/**
 * Keep a value on one line without losing where its lines break. A file body
 * or a message keeps its rows apart as `\n`; other whitespace runs collapse.
 */
const oneLine = (value: string): string =>
	value
		.replace(/\r?\n/g, "\\n")
		.replace(/[^\S\n]+/g, " ")
		.trim();
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
	return `${"  ".repeat(depth)}- ${role}${label} [ref=${node.ref}]${states}${renderNodeDetails(node)}${box}${testId}${value}`;
}

/**
 * What the platform knows about a node beyond its name, value, and states:
 * the spoken state, an error, a hint, where it sits in a list, what it can
 * do, and where the cursor is. Each detail is one bracket so a reader can
 * skip the ones that do not matter.
 */
function renderNodeDetails(node: AxViewNode): string {
	const details: string[] = [];
	if (node.state) details.push(`state=${quoted(oneLine(node.state))}`);
	if (node.error) details.push(`error=${quoted(oneLine(node.error))}`);
	if (node.hint) details.push(`hint=${quoted(oneLine(node.hint))}`);
	if (node.placeholder)
		details.push(`placeholder=${quoted(oneLine(node.placeholder))}`);
	if (node.collection) {
		details.push(`rows=${node.collection.rows}`);
		if (node.collection.cols > 1) details.push(`cols=${node.collection.cols}`);
	}
	if (node.item) {
		const { row, col, rows, cols } = node.item;
		details.push(`row=${row + 1}${rows === undefined ? "" : `/${rows}`}`);
		if ((cols ?? 1) > 1 || col > 0)
			details.push(`col=${col + 1}${cols === undefined ? "" : `/${cols}`}`);
	}
	if (node.actions && node.actions.length > 0)
		details.push(`actions=${node.actions.join(",")}`);
	if (node.selection)
		details.push(
			node.selection.start === node.selection.end
				? `cursor=${node.selection.start}`
				: `selection=${node.selection.start}-${node.selection.end}`,
		);
	if (node.maxLength !== undefined) details.push(`max=${node.maxLength}`);
	return details.map((detail) => ` [${detail}]`).join("");
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

/** One write per sheet and per kept frame, in the order of the payload. */
export type WatchArtifacts = {
	sheets: readonly (ArtifactWrite | null)[];
	frames: readonly (ArtifactWrite | null)[];
};

function pathText(artifact: ArtifactWrite | null | undefined): string {
	if (!artifact) return "path=unsaved";
	return artifact.status === "error"
		? `path=error  ${oneLine(artifact.error)}`
		: `path=${artifact.path}`;
}

function frameRange(frames: readonly number[]): string {
	const first = frames[0];
	const last = frames.at(-1);
	if (first === undefined || last === undefined) return "none";
	return first === last ? `${first}` : `${first}\u2013${last}`;
}

/** What the sampler got: the source, the spacing it kept, and the frame size. */
function frameSummary(sampling: FrameSampling): string {
	const first = sampling.frames[0];
	const size = first ? `  size=${first.width}\u00d7${first.height}` : "";
	return `source=${first ? first.source : "none"}  every=${sampling.requestedIntervalMs}ms  achieved=${sampling.achievedIntervalMs}ms${size}`;
}

/** One line per sheet, then one per frame the caller asked to keep. */
function frameLines(
	sampling: FrameSampling,
	artifacts: WatchArtifacts,
): string[] {
	return [
		...sampling.sheets.map(
			(sheet, index) =>
				`sheet  ${sheet.index}  frames=${frameRange(sheet.frames)}  grid=${sheet.columns}x${sheet.rows}  cell=${sheet.cellWidth}x${sheet.cellHeight}  ${pathText(artifacts.sheets[index])}`,
		),
		...sampling.frames.flatMap((frame, index) =>
			artifacts.frames[index]
				? [
						`frame  ${frame.index}  at=${frame.atMs}ms  ${pathText(artifacts.frames[index])}`,
					]
				: [],
		),
	];
}

export function renderWatch(
	watch: DeviceWatch,
	artifacts: WatchArtifacts,
	format: ObserveFormat = {},
): string {
	const lines = [
		[
			"watch",
			`device=${watch.device}`,
			`platform=${watch.platform}`,
			`started=${time(watch.startedAt)}`,
		].join("  "),
		`frames  ${watch.frames.length} over ${watch.durationMs}ms  ${frameSummary(watch)}`,
		...frameLines(watch, artifacts),
		...warningLines(watch.warnings),
		renderObservation(watch.observation, null, format),
	];
	return lines.join("\n");
}

export function renderWait(
	wait: DeviceWait,
	format: ObserveFormat = {},
): string {
	const condition =
		wait.condition.kind === "stable"
			? "stable"
			: `${wait.condition.kind}=${quoted(wait.condition.text)}`;
	const lines = [
		[
			"wait",
			condition,
			`satisfied=${wait.satisfied ? "yes" : "no"}`,
			`elapsed=${wait.elapsedMs}ms`,
			`polls=${wait.polls}`,
		].join("  "),
	];
	if (wait.observation.view)
		lines.push(...renderTree(wait.observation.view, format));
	else lines.push("elements  none");
	lines.push(
		...warningLines([
			...wait.warnings,
			...(wait.observation.view?.warnings ?? []),
		]),
	);
	return lines.join("\n");
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

function renderActionVerb(action: ResolvedAction): string {
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

function renderActionLine(action: ResolvedAction): string {
	const warnings = (action.warnings ?? [])
		.map((warning) => `  (${oneLine(warning)})`)
		.join("");
	return `${renderActionVerb(action)}${warnings}`;
}

const TRANSITION_KEYS = ["checked", "value"] as const;
const FLAG_KEYS = ["contentMoved", "screenChanged"] as const;

function observedWord(key: string, value: unknown): string {
	if (value === null || value === undefined) return "unknown";
	if (typeof value === "boolean")
		return key === "checked"
			? value
				? "checked"
				: "unchecked"
			: value
				? "yes"
				: "no";
	return typeof value === "string" ? quoted(value) : String(value);
}

function renderTransition(
	key: string,
	value: unknown,
	label = key,
): string | null {
	if (!value || typeof value !== "object") return null;
	if (!("before" in value) || !("after" in value)) return null;
	const pair = value as { before: unknown; after: unknown };
	return `${label}: ${observedWord(key, pair.before)} → ${observedWord(key, pair.after)}`;
}

/** Report what the action changed, not only that the device accepted it. */
function renderObserved(observed: Record<string, unknown> | null): string[] {
	if (!observed) return [];
	const parts: string[] = [];
	for (const key of TRANSITION_KEYS) {
		const transition = renderTransition(key, observed[key]);
		if (transition) parts.push(transition);
	}
	const firstVisible = renderTransition(
		"firstVisible",
		observed.firstVisible,
		"first",
	);
	if (firstVisible) parts.push(firstVisible);
	for (const key of FLAG_KEYS) {
		const flag = observed[key];
		if (typeof flag === "boolean") parts.push(`${key}=${flag ? "yes" : "no"}`);
	}
	if (observed.gone === true) parts.push("gone=yes");
	if (Array.isArray(observed.newWindows))
		for (const window of observed.newWindows)
			if (typeof window === "string") parts.push(`new: ${window}`);
	if (Array.isArray(observed.sliders))
		for (const slider of observed.sliders) {
			if (!slider || typeof slider !== "object") continue;
			const change = slider as { label?: unknown; before?: unknown; after?: unknown };
			parts.push(
				`slider ${quoted(String(change.label ?? ""))}: ${String(change.before)} → ${String(change.after)}`,
			);
		}
	return parts;
}

interface ActionSections {
	/** The action, dispatch, verification, accessibility, and image lines. */
	head: string[];
	tree: string[];
	warnings: string[];
}

const NO_WATCH_ARTIFACTS: WatchArtifacts = { sheets: [], frames: [] };

function actionSections(
	result: ActionResult,
	artifact: ArtifactWrite | null,
	format: ObserveFormat,
	resolved: boolean,
	watch: WatchArtifacts | null,
): ActionSections {
	const lines = resolved
		? result.resolved.map((action) => `action  ${renderActionLine(action)}`)
		: [];
	lines.push(`dispatch  ${result.dispatch.status}  ${result.dispatch.reason}`);
	lines.push(
		[
			"verification",
			result.verification.status,
			...renderObserved(result.verification.observed ?? null),
			result.verification.reason,
		].join("  "),
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
			? `accessibility  ok  captured=${time(accessibility.capturedAt)}  observation=${accessibility.value.observationId}${settledSuffix(result)}`
			: `accessibility  error  captured=${time(accessibility.capturedAt)}  ${oneLine(accessibility.error)}`,
	);
	if (result.image)
		lines.push(renderImage(result.image, result.captureReason));
	else lines.push("image  not_requested");
	const artifactLine = renderArtifact(artifact);
	if (artifactLine) lines.push(artifactLine);
	if (result.watch) {
		lines.push(
			`watch  ${result.watch.frames.length} frames  ${frameSummary(result.watch)}`,
		);
		lines.push(...frameLines(result.watch, watch ?? NO_WATCH_ARTIFACTS));
	}
	return {
		head: lines,
		tree: result.view
			? renderTree(result.view, format)
			: ["elements  none"],
		warnings: warningLines([
			...result.warnings,
			...(result.watch?.warnings ?? []),
			...(result.view?.warnings ?? []),
		]),
	};
}

/** How long the post-action read waited for the screen to stop changing. */
function settledSuffix(result: ActionResult): string {
	if (result.settledMs === undefined) return "";
	return result.settled
		? `  settled=${result.settledMs}ms`
		: `  settled=no (${result.settledMs}ms)`;
}

export function renderActionResult(
	result: ActionResult,
	artifact: ArtifactWrite | null = null,
	format: ObserveFormat = {},
	watch: WatchArtifacts | null = null,
): string {
	const sections = actionSections(result, artifact, format, true, watch);
	return [...sections.head, ...sections.tree, ...sections.warnings].join("\n");
}

function renderScrollItem(item: ScrollItem): string {
	const text = item.text ? ` "${oneLine(item.text)}"` : "";
	const testId = item.testId ? ` [testid=${item.testId}]` : "";
	return `  ${item.role}${text} [ref=${item.ref}]${testId}`;
}

function renderScrollLine(result: ScrollResult): string {
	const container = result.container;
	const label = container.label ? ` "${oneLine(container.label)}"` : "";
	const ref = container.ref ? ` @${container.ref}` : "";
	return [
		`action  scroll ${result.direction} in ${container.role}${label}${ref}`,
		`from ${result.from.x},${result.from.y} to ${result.to.x},${result.to.y} px`,
		`amount=${result.amount}%`,
		`duration=${result.durationMs}ms`,
		`pages=${result.pages}`,
		`endReached=${result.endReached ? "yes" : "no"}`,
	].join("  ");
}

export function renderScrollResult(
	result: ScrollResult,
	artifact: ArtifactWrite | null = null,
	format: ObserveFormat = {},
	watch: WatchArtifacts | null = null,
): string {
	const sections = actionSections(
		result.action,
		artifact,
		format,
		false,
		watch,
	);
	const collected = result.items
		? [
				`collected  ${result.count} items  selector=${result.selector ?? ""}`,
				...result.items.map(renderScrollItem),
			]
		: [];
	return [
		renderScrollLine(result),
		...sections.head,
		...collected,
		...sections.tree,
		...sections.warnings,
	].join("\n");
}

/** One line per step, then the tree the run left behind. */
export function renderSequenceResult(
	result: SequenceResult,
	format: ObserveFormat = {},
	artifacts: ReadonlyArray<ArtifactWrite | null> = [],
): string {
	const lines = result.steps.flatMap((step, index) => {
		const what = step.label ?? describeSequenceStep(step.action);
		const artifact = renderArtifact(artifacts[index] ?? null);
		return [
			`step ${step.index + 1}/${result.total}  ${what}  dispatch ${
				step.result.dispatch.status
			}  verification ${step.result.verification.status}`,
			...(artifact ? [`  ${artifact}`] : []),
		];
	});
	const last = result.steps.at(-1);
	if (result.stoppedAt !== null && last)
		lines.push(
			`stopped at step ${result.stoppedAt + 1}: ${oneLine(
				last.result.dispatch.reason,
			)}`,
		);
	if (last?.result.view) lines.push(...renderTree(last.result.view, format));
	else lines.push("elements  none");
	lines.push(
		...warningLines([
			...(last?.result.warnings ?? []),
			...(last?.result.view?.warnings ?? []),
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

/** Image bytes never travel in the printed payload. Byte counts and paths do. */
function samplingForOutput(
	sampling: FrameSampling,
	artifacts: WatchArtifacts,
): unknown {
	return {
		...sampling,
		frames: sampling.frames.map((frame, index) => ({
			...frame,
			png: frame.png ? frame.png.byteLength : null,
			artifact: artifacts.frames[index] ?? null,
		})),
		sheets: sampling.sheets.map((sheet, index) => ({
			...sheet,
			png: sheet.png.byteLength,
			artifact: artifacts.sheets[index] ?? null,
		})),
	};
}

export function watchForOutput(
	watch: DeviceWatch,
	artifacts: WatchArtifacts,
): unknown {
	return {
		...(samplingForOutput(watch, artifacts) as object),
		observation: observationForOutput(watch.observation, null),
	};
}

export function waitForOutput(wait: DeviceWait): unknown {
	return {
		...wait,
		observation: observationForOutput(wait.observation, null),
	};
}

export function actionForOutput(
	result: ActionResult,
	artifact: ArtifactWrite | null,
	watch: WatchArtifacts | null = null,
): unknown {
	return {
		...result,
		accessibility: accessibilityForOutput(result.accessibility),
		image: result.image ? imageForOutput(result.image) : null,
		...(result.watch
			? { watch: samplingForOutput(result.watch, watch ?? NO_WATCH_ARTIFACTS) }
			: {}),
		artifact,
	};
}

export function scrollForOutput(
	result: ScrollResult,
	artifact: ArtifactWrite | null,
	watch: WatchArtifacts | null = null,
): unknown {
	return {
		...result,
		action: actionForOutput(result.action, artifact, watch),
	};
}

function isActionResult(value: unknown): value is ActionResult {
	if (!value || typeof value !== "object") return false;
	const result = value as { dispatch?: unknown; verification?: unknown };
	return (
		typeof result.dispatch === "object" &&
		result.dispatch !== null &&
		typeof result.verification === "object" &&
		result.verification !== null
	);
}

/**
 * The text the CLI printed for a command, rebuilt from the result alone. A
 * reader of a trace has no artifacts on disk, so the path lines stay out.
 */
export function renderCommandOutput(
	command: TraceCommand,
	result: unknown,
): string {
	switch (command) {
		case "observe":
			return renderObservation(result as DeviceObservation, null);
		case "screenshot":
			return renderScreenshot(result as DeviceScreenshot, null);
		case "find":
			return renderMatches(result as DeviceMatches);
		case "wait":
			return renderWait(result as DeviceWait);
		case "watch":
			return renderWatch(result as DeviceWatch, NO_WATCH_ARTIFACTS);
		case "run":
			return renderSequenceResult(result as SequenceResult);
		case "scroll":
			return renderScrollResult(result as ScrollResult);
		default:
			return isActionResult(result)
				? renderActionResult(result)
				: JSON.stringify(result, null, 2);
	}
}
