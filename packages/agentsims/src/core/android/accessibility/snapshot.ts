import type {
	AxElement,
	AxRange,
	AxRect,
	AxSnapshot,
} from "../../tools/observe/accessibility";
import type { AndroidAxMode } from "./ax-server";
import { adbText } from "../device/adb";
import { getAndroidScreenConfig } from "../device/input";
import type { AndroidScreenConfig } from "../device/types";

async function readUiautomatorXml(serial: string): Promise<string> {
	// `/dev/tty` lets uiautomator return the hierarchy through one exec-out
	// request. Writing a file, reading it, and deleting it triples ADB process
	// churn and can briefly starve the emulator's video producer.
	return adbText(
		[
			"-s",
			serial,
			"exec-out",
			"uiautomator",
			"dump",
			"--compressed",
			"/dev/tty",
		],
		10_000,
	);
}

function decodeXml(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

function attrsFromNode(tag: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	const re = /([:\w-]+)="([^"]*)"/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(tag))) attrs[match[1]!] = decodeXml(match[2]!);
	return attrs;
}

function androidAxTraits(attrs: Record<string, string>): string[] | undefined {
	const traitAttributes: Array<[string, string]> = [
		["clickable", "clickable"],
		["long-clickable", "long press"],
		["focusable", "focusable"],
		["focused", "focused"],
		["scrollable", "scrollable"],
		["checkable", "checkable"],
		["checked", "checked"],
		["selected", "selected"],
		["password", "password"],
		["editable", "editable"],
	];
	const traits = traitAttributes
		.filter(([attribute]) => attrs[attribute] === "true")
		.map(([, label]) => label);
	return traits.length > 0 ? traits : undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
	if (value === undefined || value === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

/** A SeekBar, ProgressBar, or RatingBar reports where it sits in its range. */
function rangeOf(attrs: Record<string, string>): AxRange | undefined {
	const current = optionalNumber(attrs["range-current"]);
	const min = optionalNumber(attrs["range-min"]);
	const max = optionalNumber(attrs["range-max"]);
	if (current === undefined || min === undefined || max === undefined)
		return undefined;
	return { current, min, max };
}

type ElementDetails = Pick<
	AxElement,
	| "placeholder"
	| "hint"
	| "state"
	| "error"
	| "paneTitle"
	| "heading"
	| "labeledBy"
	| "collection"
	| "item"
	| "actions"
	| "selection"
	| "maxLength"
>;

/** Everything the helper reports beyond name, value, and traits. */
function detailsOf(
	attrs: Record<string, string>,
	placeholder: string,
): ElementDetails {
	const details: ElementDetails = {};
	if (placeholder) details.placeholder = placeholder;
	if (attrs.tooltip) details.hint = attrs.tooltip;
	if (attrs["state-desc"]) details.state = attrs["state-desc"];
	if (attrs.error) details.error = attrs.error;
	if (attrs["pane-title"]) details.paneTitle = attrs["pane-title"];
	if (attrs.heading === "true") details.heading = true;
	if (attrs["labeled-by"]) details.labeledBy = attrs["labeled-by"];
	const rows = optionalInteger(attrs["collection-rows"]);
	const cols = optionalInteger(attrs["collection-cols"]);
	if (rows !== undefined && cols !== undefined)
		details.collection = { rows, cols };
	const row = optionalInteger(attrs["item-row"]);
	const col = optionalInteger(attrs["item-col"]);
	if (row !== undefined && col !== undefined) {
		const rowSpan = optionalInteger(attrs["item-row-span"]);
		const colSpan = optionalInteger(attrs["item-col-span"]);
		details.item = {
			row,
			col,
			...(rowSpan === undefined ? {} : { rowSpan }),
			...(colSpan === undefined ? {} : { colSpan }),
		};
	}
	if (attrs.actions) details.actions = attrs.actions.split(",").filter(Boolean);
	const start = optionalInteger(attrs["selection-start"]);
	const end = optionalInteger(attrs["selection-end"]);
	if (start !== undefined && end !== undefined) details.selection = { start, end };
	const maxLength = optionalInteger(attrs["max-length"]);
	if (maxLength !== undefined) details.maxLength = maxLength;
	return details;
}

function boundsToRect(bounds: string | undefined) {
	const match = bounds?.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
	if (!match) return null;
	const left = Number(match[1]);
	const top = Number(match[2]);
	const right = Number(match[3]);
	const bottom = Number(match[4]);
	return {
		x: left,
		y: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
}

interface AndroidXmlNodeToken {
	attrs: Record<string, string>;
	path: string;
}

function androidXmlNodes(xml: string): AndroidXmlNodeToken[] {
	const nodes: AndroidXmlNodeToken[] = [];
	const ancestry: Array<{ path: string; nextChild: number }> = [];
	const tokenRe = /<node\b[^>]*\/?>|<\/node\s*>/g;
	let rootIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = tokenRe.exec(xml))) {
		const token = match[0];
		if (token.startsWith("</")) {
			ancestry.pop();
			continue;
		}

		const parent = ancestry.at(-1);
		const path = parent
			? `${parent.path}.${parent.nextChild++}`
			: String(rootIndex++);
		nodes.push({ attrs: attrsFromNode(token), path });
		if (!/\/>\s*$/.test(token)) {
			ancestry.push({ path, nextChild: 0 });
		}
	}

	return nodes;
}

function clampAndroidFrameToScreen(
	frame: AxRect,
	screen: { width: number; height: number },
): AxRect {
	const left = Math.min(screen.width, Math.max(0, frame.x));
	const top = Math.min(screen.height, Math.max(0, frame.y));
	const right = Math.min(screen.width, Math.max(0, frame.x + frame.width));
	const bottom = Math.min(screen.height, Math.max(0, frame.y + frame.height));
	return {
		x: left,
		y: top,
		width: Math.max(0, right - left),
		height: Math.max(0, bottom - top),
	};
}

function optionalInteger(value: string | undefined): number | undefined {
	if (value === undefined || !/^-?\d+$/.test(value)) return undefined;
	return Number(value);
}

export interface AndroidAxSnapshotDependencies {
	readXml?: (serial: string) => Promise<string>;
	readFastXml?: (serial: string, mode: AndroidAxMode) => Promise<string>;
	readFallbackXml?: (serial: string) => Promise<string>;
	readScreenConfig?: (serial: string) => Promise<AndroidScreenConfig>;
	screen?: Pick<AndroidScreenConfig, "width" | "height">;
	mode?: AndroidAxMode;
}

export async function collectAndroidAxSnapshot(
	serial: string,
	dependencies: AndroidAxSnapshotDependencies = {},
): Promise<AxSnapshot> {
	const readXml =
		dependencies.readXml ??
		(async (targetSerial: string) => {
			const readFallbackXml =
				dependencies.readFallbackXml ?? readUiautomatorXml;
			if (!dependencies.readFastXml) return readFallbackXml(targetSerial);
			// Both providers need Android's single UiAutomation connection. If the
			// persistent helper times out, starting stock UIAutomator can compete
			// with a device-side helper that has not exited yet. Report the helper
			// failure and let the streamer's retry backoff recover instead.
			return dependencies.readFastXml(
				targetSerial,
				dependencies.mode ?? "fresh",
			);
		});
	const readScreenConfig =
		dependencies.readScreenConfig ?? getAndroidScreenConfig;
	try {
		const xml = await readXml(serial);
		const config =
			dependencies.screen ?? (await readScreenConfig(serial));
		const screen = { width: config.width, height: config.height };
		const elements: AxElement[] = [];
		for (const { attrs, path } of androidXmlNodes(xml)) {
			const frame = boundsToRect(attrs.bounds);
			// Zero-area nodes are often structural accessibility containers. Keep
			// them in the raw tree so paths remain an exact representation of the
			// native hierarchy; overlay eligibility belongs to browser consumers.
			if (!frame) continue;
			// An empty field reports its hint as its text, and a filled field would
			// otherwise report one string as both its name and its value.
			const editable = attrs.editable === "true";
			const hint = attrs["hint-text"] === "true";
			const text = hint ? "" : attrs.text || "";
			const label =
				attrs["content-desc"] || (editable ? (hint ? attrs.text || "" : "") : text);
			const role = attrs.class || "android.view.View";
			const nativeId = attrs["resource-id"] || undefined;
			const windowId = optionalInteger(attrs["window-id"]);
			const sourceId = optionalInteger(attrs["source-id"]);
			const windowLayer = optionalInteger(attrs["window-layer"]);
			const windowType = optionalInteger(attrs["window-type"]);
			const range = rangeOf(attrs);
			const details = detailsOf(attrs, hint ? attrs.text || "" : "");
			elements.push({
				id:
					windowId !== undefined && sourceId !== undefined
						? `${windowId}:${sourceId}`
						: nativeId || `${serial}:${path}`,
				path,
				label,
				value: text,
				role,
				type: role,
				enabled: attrs.enabled !== "false",
				visibleToUser: attrs["visible-to-user"] !== "false",
				...(windowId === undefined ? {} : { windowId }),
				...(sourceId === undefined ? {} : { sourceId }),
				...(windowLayer === undefined ? {} : { windowLayer }),
				...(windowType === undefined ? {} : { windowType }),
				...(attrs["window-active"] === undefined
					? {}
					: { windowActive: attrs["window-active"] === "true" }),
				...(attrs["window-focused"] === undefined
					? {}
					: { windowFocused: attrs["window-focused"] === "true" }),
				frame,
				testId: nativeId,
				nativeId,
				traits: androidAxTraits(attrs),
				...(range ? { range } : {}),
				...details,
			});
		}
		if (elements.length === 0) {
			return {
				screen,
				elements,
				errors: ["UIAutomator returned no accessibility elements"],
			};
		}
		return {
			screen,
			elements: elements.map((element) => ({
				...element,
				frame: clampAndroidFrameToScreen(element.frame, screen),
			})),
		};
	} catch (error) {
		const config = await readScreenConfig(serial).catch(() => ({
			width: 1,
			height: 1,
			orientation: "portrait" as const,
		}));
		return {
			screen: { width: config.width, height: config.height },
			elements: [],
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}
