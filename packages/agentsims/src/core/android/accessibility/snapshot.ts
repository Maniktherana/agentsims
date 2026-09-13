import type {
	AxElement,
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
	];
	const traits = traitAttributes
		.filter(([attribute]) => attrs[attribute] === "true")
		.map(([, label]) => label);
	return traits.length > 0 ? traits : undefined;
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

function screenFromAndroidElements(
	elements: AxElement[],
	fallback: { width: number; height: number },
): { width: number; height: number } {
	// The helper orders application windows from base to topmost layer. That
	// first app root is the authoritative AX viewport: hidden descendants and
	// inactive windows can retain stale, off-screen layout bounds and must not
	// enlarge the simulated display.
	const roots = elements.filter((element) => !element.path.includes("."));
	const viewport =
		roots.find((element) => element.windowType === 1) ?? roots[0];
	if (viewport && viewport.frame.width > 0 && viewport.frame.height > 0) {
		return {
			width: Math.max(1, viewport.frame.x + viewport.frame.width),
			height: Math.max(1, viewport.frame.y + viewport.frame.height),
		};
	}

	let right = 0;
	let bottom = 0;
	for (const element of elements) {
		right = Math.max(right, element.frame.x + element.frame.width);
		bottom = Math.max(bottom, element.frame.y + element.frame.height);
	}
	if (right > 0 && bottom > 0) return { width: right, height: bottom };
	return fallback;
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
	mode?: AndroidAxMode;
}

export async function collectAndroidAxSnapshot(
	serial: string,
	dependencies: AndroidAxSnapshotDependencies = {},
): Promise<AxSnapshot> {
	let providerWarning: string | undefined;
	const readXml =
		dependencies.readXml ??
		(async (targetSerial: string) => {
			const readFallbackXml =
				dependencies.readFallbackXml ?? readUiautomatorXml;
			if (!dependencies.readFastXml) return readFallbackXml(targetSerial);
			try {
				return await dependencies.readFastXml(
					targetSerial,
					dependencies.mode ?? "fresh",
				);
			} catch (error) {
				// Hidden UiAutomation APIs vary across Android releases and another
				// automation tool may temporarily own the single system connection.
				// Keep the stock command as a correctness fallback.
				providerWarning = `Fast Android AX unavailable; using stock UIAutomator: ${
					error instanceof Error ? error.message : String(error)
				}`;
				return readFallbackXml(targetSerial);
			}
		});
	const readScreenConfig =
		dependencies.readScreenConfig ?? getAndroidScreenConfig;
	try {
		const xml = await readXml(serial);
		const elements: AxElement[] = [];
		for (const { attrs, path } of androidXmlNodes(xml)) {
			if (elements.length >= 500) break;
			const frame = boundsToRect(attrs.bounds);
			// Zero-area nodes are often structural accessibility containers. Keep
			// them in the raw tree so paths remain an exact representation of the
			// native hierarchy; overlay eligibility belongs to browser consumers.
			if (!frame) continue;
			const label = attrs["content-desc"] || attrs.text || "";
			const role = attrs.class || "android.view.View";
			const nativeId = attrs["resource-id"] || undefined;
			const windowId = optionalInteger(attrs["window-id"]);
			const windowLayer = optionalInteger(attrs["window-layer"]);
			const windowType = optionalInteger(attrs["window-type"]);
			elements.push({
				id: nativeId || `${serial}:${path}`,
				path,
				label,
				value: attrs.text || "",
				role,
				type: role,
				enabled: attrs.enabled !== "false",
				visibleToUser: attrs["visible-to-user"] !== "false",
				...(windowId === undefined ? {} : { windowId }),
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
			});
		}
		if (elements.length === 0) {
			const config = await readScreenConfig(serial);
			return {
				screen: { width: config.width, height: config.height },
				elements,
				errors: [
					...(providerWarning ? [providerWarning] : []),
					"UIAutomator returned no accessibility elements",
				],
			};
		}
		const screen = screenFromAndroidElements(elements, { width: 1, height: 1 });
		return {
			screen,
			elements: elements.map((element) => ({
				...element,
				frame: clampAndroidFrameToScreen(element.frame, screen),
			})),
			...(providerWarning ? { errors: [providerWarning] } : {}),
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
			errors: [
				...(providerWarning ? [providerWarning] : []),
				error instanceof Error ? error.message : String(error),
			],
		};
	}
}
