import type { LogLevel, LogRecordInput } from "../../tools/logs/contracts";

export const RN_LOG_LIMITS = Object.freeze({
	discoveryBytes: 1_024 * 1_024,
	targets: 100,
	messageBytes: 64 * 1_024,
	inboxRecords: 64,
	inboxBytes: 1_024 * 1_024,
	frames: 32,
	symbolicationBytes: 64 * 1_024,
});

export function object(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

export function textBound(value: string, characters: number, bytes = Infinity) {
	let end = 0;
	let count = 0;
	let size = 0;
	for (const point of value) {
		const length = Buffer.byteLength(point);
		if (count === characters || size + length > bytes) break;
		end += point.length;
		count++;
		size += length;
	}
	return { value: value.slice(0, end), truncated: end < value.length };
}

function label(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 512;
}

/** The caller supplies one local Metro origin, never an arbitrary discovery URL. */
export function metroOrigin(value: string): URL {
	const url = new URL(value);
	if (
		!["http:", "https:"].includes(url.protocol) ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== "/"
	)
		throw new Error("Select a local Metro HTTP origin");
	return url;
}

export type InspectorTarget = {
	readonly id: string;
	readonly app: string;
	readonly socketUrl: string;
};

export type InspectorSelection =
	| { readonly target: InspectorTarget }
	| {
			readonly state: "waiting" | "unavailable" | "debugger-conflict";
			readonly reason: string;
	  };

/** Missing or false effective capabilities must be rejected before socket creation. */
export function selectInspectorTarget(
	list: unknown,
	metro: URL,
	targetId: string,
	app: string,
): InspectorSelection {
	if (!Array.isArray(list) || list.length > RN_LOG_LIMITS.targets)
		return {
			state: "unavailable",
			reason: "Invalid Metro inspector target list",
		};
	const matches = list.filter((entry) => object(entry)?.id === targetId);
	if (!matches.length)
		return {
			state: "waiting",
			reason: "Waiting for the selected inspector target",
		};
	if (matches.length !== 1)
		return {
			state: "unavailable",
			reason: "The inspector target is ambiguous",
		};
	const entry = object(matches[0])!;
	if (entry.appId !== app || !label(entry.appId))
		return {
			state: "unavailable",
			reason: "The inspector target belongs to another application",
		};
	const rn = object(entry.reactNative);
	if (object(rn?.capabilities)?.supportsMultipleDebuggers !== true)
		return {
			state: "debugger-conflict",
			reason:
				"This inspector does not advertise support for multiple debuggers",
		};
	try {
		if (typeof entry.webSocketDebuggerUrl !== "string") throw new Error();
		const socket = new URL(entry.webSocketDebuggerUrl);
		const device = socket.searchParams.getAll("device");
		const page = socket.searchParams.getAll("page");
		if (
			socket.protocol !== (metro.protocol === "https:" ? "wss:" : "ws:") ||
			socket.host !== metro.host ||
			socket.username ||
			socket.password ||
			socket.hash ||
			socket.pathname !== "/inspector/debug" ||
			device.length !== 1 ||
			page.length !== 1 ||
			!label(device[0]) ||
			!label(page[0]) ||
			rn?.logicalDeviceId !== device[0] ||
			entry.id !== `${device[0]}-${page[0]}` ||
			[...socket.searchParams.keys()].some(
				(key) => key !== "device" && key !== "page",
			)
		)
			throw new Error();
		return {
			target: Object.freeze({ id: targetId, app, socketUrl: socket.href }),
		};
	} catch {
		return {
			state: "unavailable",
			reason: "Invalid local inspector socket URL",
		};
	}
}

export type RnStackFrame = {
	readonly file: string;
	readonly methodName: string;
	/** Metro uses a one-based line and a zero-based column. */
	readonly lineNumber: number;
	readonly column: number;
};

export type RnProtocolLog = {
	readonly record: LogRecordInput;
	readonly frames: readonly RnStackFrame[];
};

function index(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isSafeInteger(value) &&
		value >= 0 &&
		value < 2_147_483_647
	);
}

function stackFrames(value: unknown): {
	frames: readonly RnStackFrame[];
	truncated: boolean;
} {
	const frames: RnStackFrame[] = [];
	let stack = object(value);
	let depth = 0;
	let truncated = false;
	while (stack && depth++ < 4) {
		if (Array.isArray(stack.callFrames)) {
			for (const raw of stack.callFrames) {
				if (frames.length === RN_LOG_LIMITS.frames) {
					truncated = true;
					break;
				}
				const frame = object(raw);
				if (
					!frame ||
					typeof frame.url !== "string" ||
					!index(frame.lineNumber) ||
					!index(frame.columnNumber)
				)
					continue;
				const file = textBound(frame.url, 2_048);
				const methodName = textBound(
					typeof frame.functionName === "string" ? frame.functionName : "",
					512,
				);
				truncated ||= file.truncated || methodName.truncated;
				frames.push(
					Object.freeze({
						file: file.value,
						methodName: methodName.value,
						lineNumber: frame.lineNumber + 1,
						column: frame.columnNumber,
					}),
				);
			}
		}
		stack = object(stack.parent);
	}
	return {
		frames: Object.freeze(frames),
		truncated: truncated || stack !== null,
	};
}

export function renderRnStack(frames: readonly RnStackFrame[]): string {
	return frames
		.map(
			(frame) =>
				`${frame.methodName || "(anonymous)"} (${frame.file}:${frame.lineNumber}:${frame.column + 1})`,
		)
		.join("\n");
}

function remoteText(value: unknown): string {
	const remote = object(value);
	if (!remote) return "";
	if (typeof remote.value === "string") return remote.value;
	if (
		remote.value === null ||
		typeof remote.value === "boolean" ||
		typeof remote.value === "number"
	)
		return String(remote.value);
	if (typeof remote.unserializableValue === "string")
		return remote.unserializableValue;
	if (typeof remote.description === "string") return remote.description;
	return typeof remote.type === "string" ? `[${remote.type}]` : "";
}

const consoleLevels: Record<string, LogLevel> = {
	log: "info",
	info: "info",
	debug: "debug",
	warning: "warn",
	warn: "warn",
	error: "error",
	assert: "error",
	trace: "trace",
	dir: "info",
	dirxml: "info",
	table: "info",
	startGroup: "info",
	startGroupCollapsed: "info",
	count: "info",
	timeEnd: "info",
};

/** Decode only Runtime events. No remote evaluation or object expansion is required. */
export function parseRnLog(
	packet: unknown,
	context: {
		device: string;
		platform: "ios" | "android";
		app: string;
		projectId: string;
		receivedAt: number;
		pid?: number;
	},
): RnProtocolLog | null {
	const data = object(packet);
	const params = object(data?.params);
	if (!params) return null;
	let message: string;
	let nativeLevel: string;
	let level: LogLevel;
	let trace: unknown;
	let description = "";
	let truncated = false;
	if (data?.method === "Runtime.consoleAPICalled") {
		if (
			typeof params.type !== "string" ||
			!Object.hasOwn(consoleLevels, params.type) ||
			!Array.isArray(params.args)
		)
			return null;
		nativeLevel = params.type;
		level = consoleLevels[nativeLevel]!;
		message = params.args.slice(0, 32).map(remoteText).join(" ");
		truncated = params.args.length > 32;
		trace = params.stackTrace;
	} else if (data?.method === "Runtime.exceptionThrown") {
		const details = object(params.exceptionDetails);
		if (!details) return null;
		description = remoteText(details.exception);
		message =
			description.split("\n", 1)[0] ||
			(typeof details.text === "string" ? details.text : "");
		if (!message) return null;
		nativeLevel = "exception";
		level = "error";
		trace = details.stackTrace;
		if (
			!trace &&
			typeof details.url === "string" &&
			index(details.lineNumber) &&
			index(details.columnNumber)
		)
			trace = {
				callFrames: [
					{
						url: details.url,
						functionName: "",
						lineNumber: details.lineNumber,
						columnNumber: details.columnNumber,
					},
				],
			};
	} else return null;
	const parsed = stackFrames(trace);
	const boundedMessage = textBound(message, 4_096);
	const rawStack = parsed.frames.length
		? renderRnStack(parsed.frames)
		: description.includes("\n")
			? description
			: "";
	const boundedStack = textBound(rawStack, Infinity, 16 * 1_024);
	const timestamp = params.timestamp;
	const sourceTime =
		typeof timestamp === "number" &&
		Number.isFinite(timestamp) &&
		timestamp >= 0
			? Object.freeze({ text: String(timestamp), epochMs: timestamp })
			: undefined;
	return Object.freeze({
		frames: parsed.frames,
		record: Object.freeze({
			...context,
			source: "react-native",
			sourceTime,
			level,
			nativeLevel,
			message: boundedMessage.value,
			stack: boundedStack.value || undefined,
			truncated:
				truncated ||
				parsed.truncated ||
				boundedMessage.truncated ||
				boundedStack.truncated,
		}),
	});
}
