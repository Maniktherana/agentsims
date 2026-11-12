import type { AxSourceContext } from "../observe/accessibility-model";
import type {
	ContextInput,
	ContextNode,
	ContextNodeList,
	ContextTarget,
} from "./contracts";

/** One note in the agent prompt. Browser copy, send, HTTP, CLI, and MCP use this. */
export type ContextPromptEntry = {
	/** The current note text. Captured evidence can hold an older draft. */
	readonly note: string;
	readonly evidence: ContextInput;
	readonly deviceName?: string;
	/** A local file path for the screenshot. Without it, the prompt cites the attached image. */
	readonly screenshot?: string;
};

export const CONTEXT_PROMPT_DETAILS = [
	"compact",
	"standard",
	"detailed",
] as const;
export type ContextPromptDetail = (typeof CONTEXT_PROMPT_DETAILS)[number];

export function isContextPromptDetail(
	value: unknown,
): value is ContextPromptDetail {
	return CONTEXT_PROMPT_DETAILS.includes(value as ContextPromptDetail);
}

type Annotation = Extract<ContextInput, { kind: "annotation" }>;
type ElementTarget = Extract<ContextTarget, { kind: "element" }>;

const SOURCE_MATCHES: Partial<
	Record<NonNullable<AxSourceContext["matchReason"]>, string>
> = {
	"ancestor-owner": "enclosing component, not the target",
	"nearby-visible-text": "matched by nearby text, verify",
	"nearby-accessibility-label": "matched by a nearby label, verify",
	"nearby-placeholder": "matched by a nearby placeholder, verify",
	"nearby-carrier-text": "matched by nearby text, verify",
	"nearby-host-type": "matched by element type, verify",
};

function clip(value: string, characters = 200): string {
	const text = value.replace(/\s+/g, " ").trim();
	return text.length > characters ? `${text.slice(0, characters - 1)}…` : text;
}

function quote(value: string): string {
	return JSON.stringify(clip(value));
}

function px(value: number): number {
	return Math.round(value);
}

function timestamp(value: number): string {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function field(name: string, value: string): string {
	return `**${name}:** ${value}`;
}

function sourceLocation(source: AxSourceContext | undefined): string | null {
	if (!source?.file || !source.line) return null;
	return `${source.file}:${source.line}${source.column ? `:${source.column}` : ""}`;
}

function node(value: ContextNode): string {
	const kind = [value.role, value.type]
		.filter((name, index, all) => name && all.indexOf(name) === index)
		.join(" ");
	return [
		kind || null,
		value.label ? quote(value.label) : null,
		value.testId ? `testID ${value.testId}` : null,
		value.source ? `at ${value.source}` : null,
	]
		.filter(Boolean)
		.join(" ");
}

function list(name: string, value: ContextNodeList | undefined): string[] {
	if (!value?.total) return [];
	const shown = value.items.length;
	const count = `${value.total} total${shown < value.total ? `, ${shown} shown` : ""}`;
	return [
		field(
			name,
			shown ? `${value.items.map(node).join("; ")} (${count})` : `(${count})`,
		),
	];
}

/** Names the target the way a code search finds it: role, then visible text. */
function heading(evidence: ContextInput): string {
	if (evidence.kind === "logs") return "logs";
	if (evidence.target.kind === "region") return "free region";
	const element = evidence.target.element;
	const role = clip(element.role || element.type, 80);
	const label = element.label.trim();
	return [role, label ? quote(label) : null].filter(Boolean).join(" ") || "element";
}

function elementLines(
	evidence: Annotation,
	target: ElementTarget,
	detail: ContextPromptDetail,
): string[] {
	const element = target.element;
	const structure = target.structure;
	const source = element.source;
	const location =
		sourceLocation(source) ??
		(evidence.source ? `${evidence.source.file}:${evidence.source.line}` : null);
	const lines: string[] = [];
	if (location) {
		const match = source?.matchReason && SOURCE_MATCHES[source.matchReason];
		lines.push(field("Source", `${location}${match ? ` — ${match}` : ""}`));
	} else if (detail !== "compact") {
		const keys = [
			element.testId ? "testID" : null,
			element.label.trim() ? "label" : null,
			detail === "detailed" && structure?.nearby?.length
				? "nearby text"
				: null,
		].filter(Boolean);
		lines.push(
			field(
				"Source",
				`not available — find by ${keys.length ? keys.join(" or ") : "the screenshot"}`,
			),
		);
	}
	if (element.testId && (detail !== "compact" || !location))
		lines.push(field("testID", clip(element.testId)));
	if (detail === "compact") return lines;
	if (
		detail === "detailed" &&
		element.nativeId &&
		element.nativeId !== element.testId
	)
		lines.push(field("Native ID", clip(element.nativeId)));
	const value = element.value.trim();
	if (detail === "detailed" && value && value !== element.label.trim())
		lines.push(field("Value", quote(value)));
	const owners = source?.ownerStack?.length
		? source.ownerStack
		: source?.componentName
			? [source.componentName]
			: [];
	if (owners.length)
		lines.push(
			field(
				"React",
				owners
					.slice(-4)
					.map((owner) => clip(owner, 80))
					.join(" > "),
			),
		);
	return lines;
}

function structureLines(target: ElementTarget, detail: ContextPromptDetail) {
	const structure = target.structure;
	if (!structure || detail === "compact") return [];
	const lines: string[] = [];
	if (structure.instance)
		lines.push(
			field(
				"Instance",
				`${structure.instance.index} of ${structure.instance.total} with this ${structure.instance.basis === "source" ? "source" : "role and label"} — change only this one`,
			),
		);
	if (detail !== "detailed") return lines;
	if (structure.ancestors?.length)
		lines.push(
			field(
				"Enclosing",
				`${structure.ancestors.map(node).join(" < ")} (nearest first)`,
			),
		);
	lines.push(...list("Siblings", structure.siblings));
	lines.push(...list("Children", structure.children));
	if (structure.nearby?.length)
		lines.push(
			field("Nearby text", structure.nearby.map((text) => quote(text)).join(", ")),
		);
	return lines;
}

function screenshotLine(
	evidence: Annotation,
	entry: ContextPromptEntry,
	image: number,
): string {
	return field(
		"Screenshot",
		`${evidence.image.width}x${evidence.image.height} px — ${entry.screenshot || `attached image ${image}`}`,
	);
}

function noteLines(
	entry: ContextPromptEntry,
	number: number,
	image: number | null,
	sharedScreenshot: boolean,
	detail: ContextPromptDetail,
): string[] {
	const evidence = entry.evidence;
	const lines = [`### ${number}. ${heading(evidence)}`];
	if (evidence.kind === "annotation") {
		const target = evidence.target;
		const rect = target.rect;
		const position = field(
			"Position",
			`${px(rect.x)}, ${px(rect.y)} (${px(rect.width)}x${px(rect.height)})`,
		);
		if (target.kind === "element") {
			lines.push(...elementLines(evidence, target, detail));
			if (detail !== "compact") lines.push(position);
			if (detail === "detailed")
				lines.push(field("Orientation", clip(target.orientation)));
			lines.push(...structureLines(target, detail));
		} else {
			// A region has no element identity. Its position and overlap are all it has.
			lines.push(
				field(
					"Source",
					"not available — free region, find it from the screenshot",
				),
				position,
			);
			if (target.overlaps)
				lines.push(
					field("Overlaps", `${quote(target.overlaps)} — native label, not verified`),
				);
		}
		if (!sharedScreenshot) lines.push(screenshotLine(evidence, entry, image!));
		if (detail === "detailed" && evidence.source?.lines.length) {
			const source = evidence.source;
			lines.push(
				field("Code", source.file),
				...source.lines.map(
					(line, offset) => `${source.startLine + offset}: ${line}`,
				),
			);
		}
	} else lines.push(field("Captured", timestamp(evidence.capturedAt)));
	if (evidence.logs.length)
		lines.push(
			field("Logs", String(evidence.logs.length)),
			...evidence.logs.map(
				(record) =>
					`${record.sourceTime?.text ?? timestamp(record.receivedAt)} [${record.level}] ${record.tag ? `${record.tag}: ` : ""}${record.message}${record.stack ? `\n${record.stack}` : ""}`,
			),
		);
	const note = entry.note.trim();
	if (note) lines.push(field("Feedback", note));
	return lines;
}

function deviceName(entry: ContextPromptEntry): string {
	const evidence = entry.evidence;
	return (
		entry.deviceName?.trim() ||
		(evidence.kind === "annotation" ? evidence.deviceName : undefined) ||
		evidence.device
	);
}

function appOf(evidence: ContextInput): string | null {
	return evidence.kind === "annotation" && evidence.target.kind === "element"
		? evidence.target.app
		: null;
}

/** Notes share a capture only when their image bytes are identical. */
export function sameContextCapture(a: ContextInput, b: ContextInput): boolean {
	return (
		a.kind === "annotation" &&
		b.kind === "annotation" &&
		a.image.mimeType === b.image.mimeType &&
		a.image.base64 === b.image.base64
	);
}

/**
 * The only formatter for annotation and log notes that an agent receives.
 * Note N cites attached image N, and copied images mark note N with "N".
 */
export function formatContextPrompt(
	entries: readonly ContextPromptEntry[],
	detail: ContextPromptDetail = "standard",
): string {
	// Consecutive notes from one device and app share a header.
	const groups: { entries: number[]; device: string; app: string | null }[] =
		[];
	entries.forEach((entry, index) => {
		const app = appOf(entry.evidence);
		const last = groups.at(-1);
		if (
			last &&
			last.device === entry.evidence.device &&
			(!app || !last.app || app === last.app)
		) {
			last.entries.push(index);
			last.app ??= app;
		} else groups.push({ entries: [index], device: entry.evidence.device, app });
	});
	const images: (number | null)[] = [];
	let image = 0;
	for (const entry of entries)
		images.push(entry.evidence.kind === "annotation" ? ++image : null);
	return groups
		.map((group) => {
			const first = entries[group.entries[0]!]!;
			const platform = first.evidence.platform === "ios" ? "iOS" : "Android";
			const captured = group.entries.filter(
				(index) => entries[index]!.evidence.kind === "annotation",
			);
			const shared =
				captured.length > 0 &&
				captured.every((index) =>
					sameContextCapture(
						entries[captured[0]!]!.evidence,
						entries[index]!.evidence,
					),
				);
			const header = [
				`## Screen feedback: ${group.app ? `${group.app} on ` : ""}${deviceName(first)} (${platform})`,
			];
			if (shared) {
				const entry = entries[captured[0]!]!;
				header.push(
					screenshotLine(entry.evidence as Annotation, entry, images[captured[0]!]!),
				);
			}
			return [
				header.join("\n"),
				...group.entries.map((index) =>
					noteLines(
						entries[index]!,
						index + 1,
						images[index]!,
						shared,
						detail,
					).join("\n"),
				),
			].join("\n\n");
		})
		.join("\n\n");
}
